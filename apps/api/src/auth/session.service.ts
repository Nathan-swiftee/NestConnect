import { Injectable } from "@nestjs/common";
import type { SessionInfo } from "@ding/schemas";
import { Store } from "../data/store";
import { parseUserAgent } from "./ua";

/**
 * Sign-in session bookkeeping: create sessions at login, tell the guard whether
 * a session is still active (for remote sign-out), throttle lastSeenAt writes,
 * and list/revoke sessions for the "where you're signed in" settings panel.
 *
 * The validity + touch caches are per-node — good at this scale; a shared cache
 * (Redis) would be the multi-node upgrade. Worst case, a remote sign-out on
 * another node takes up to VALID_TTL_MS to be honoured here.
 */
@Injectable()
export class SessionService {
  constructor(private readonly store: Store) {}

  private readonly validCache = new Map<string, { valid: boolean; at: number }>();
  private readonly lastTouch = new Map<string, number>();
  private static readonly VALID_TTL_MS = 30_000;
  private static readonly TOUCH_EVERY_MS = 120_000;

  /** Record a new signed-in device and return its id (the JWT's `jti`). */
  async create(userId: string, meta: { ip?: string; userAgent?: string }): Promise<string> {
    const s = await this.store.createSession(userId, meta);
    this.validCache.set(s.id, { valid: true, at: Date.now() });
    return s.id;
  }

  /** Whether a session is still active (briefly cached to avoid a per-request hit). */
  async isValid(sessionId: string): Promise<boolean> {
    const cached = this.validCache.get(sessionId);
    if (cached && Date.now() - cached.at < SessionService.VALID_TTL_MS) return cached.valid;
    const s = await this.store.getSession(sessionId);
    const valid = !!s && !s.revokedAt;
    this.validCache.set(sessionId, { valid, at: Date.now() });
    return valid;
  }

  /** Bump lastSeenAt at most once every couple of minutes (fire-and-forget). */
  touch(sessionId: string): void {
    const last = this.lastTouch.get(sessionId) ?? 0;
    if (Date.now() - last < SessionService.TOUCH_EVERY_MS) return;
    this.lastTouch.set(sessionId, Date.now());
    void this.store.touchSession(sessionId).catch(() => {});
  }

  /** Active sessions for the settings list, with `current` flagged. */
  async list(userId: string, currentId?: string): Promise<SessionInfo[]> {
    const rows = await this.store.listSessions(userId);
    return rows
      .filter((s) => !s.revokedAt)
      .map((s) => {
        const { browser, os } = parseUserAgent(s.userAgent);
        return {
          id: s.id,
          current: s.id === currentId,
          ip: s.ip,
          browser,
          os,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
        };
      });
  }

  /** Revoke one of a user's own sessions (remote sign-out). */
  async revoke(userId: string, id: string): Promise<boolean> {
    const ok = await this.store.revokeSession(userId, id);
    if (ok) this.validCache.set(id, { valid: false, at: Date.now() });
    return ok;
  }

  /** Sign out every other session for a user; returns how many were revoked. */
  async revokeOthers(userId: string, keepId: string): Promise<number> {
    const n = await this.store.revokeOtherSessions(userId, keepId);
    this.validCache.clear(); // simplest correct invalidation across the pool
    return n;
  }
}
