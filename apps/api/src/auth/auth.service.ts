import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { User } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";

/** Failed logins allowed per account before a cooldown kicks in, and the window. */
const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(private readonly store: Store) {}

  // Per-account failed-attempt tracking to slow credential brute-forcing.
  // In-memory (per node) — good enough at this scale; a shared store would be
  // the multi-node upgrade.
  private readonly failures = new Map<string, { count: number; first: number }>();

  private key(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Throw 429 if this account has too many recent failures. Call before validate. */
  assertNotThrottled(email: string): void {
    const rec = this.failures.get(this.key(email));
    if (!rec) return;
    if (Date.now() - rec.first > WINDOW_MS) {
      this.failures.delete(this.key(email));
      return;
    }
    if (rec.count >= MAX_FAILURES) {
      throw new HttpException("Too many login attempts — try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(email: string): void {
    const k = this.key(email);
    const rec = this.failures.get(k);
    if (!rec || Date.now() - rec.first > WINDOW_MS) {
      this.failures.set(k, { count: 1, first: Date.now() });
    } else {
      rec.count += 1;
    }
  }

  /** Verify email + password against the stored bcrypt hash. */
  async validate(email: string, password: string): Promise<User | null> {
    const user = await this.store.findUserByEmail(email);
    if (!user) {
      this.recordFailure(email);
      return null;
    }
    const hash = await this.store.getPasswordHash(user.id);
    if (!hash || !(await bcrypt.compare(password, hash))) {
      this.recordFailure(email);
      return null;
    }
    this.failures.delete(this.key(email));
    return user;
  }

  /** Sign a session cookie. The session id (when given) rides as the JWT `jti`
   *  so a revoked session invalidates the cookie server-side. */
  sign(userId: string, sessionId?: string): string {
    return jwt.sign(
      { sub: userId, ...(sessionId ? { jti: sessionId } : {}) },
      env.auth.jwtSecret,
      { expiresIn: env.auth.ttlSeconds },
    );
  }

  verify(token: string): { userId: string; sessionId?: string } | undefined {
    try {
      const p = jwt.verify(token, env.auth.jwtSecret) as { sub?: string; jti?: string; twofa?: string };
      // A half-authenticated "2FA pending" token is never a full session.
      if (!p.sub || p.twofa) return undefined;
      return { userId: p.sub, sessionId: p.jti };
    } catch {
      return undefined;
    }
  }

  /** Short-lived token issued after the password step when 2FA is required — it
   *  ONLY authorises the /auth/login/2fa code check, never a real session. */
  signPending(userId: string): string {
    return jwt.sign({ sub: userId, twofa: "pending" }, env.auth.jwtSecret, { expiresIn: 300 });
  }

  verifyPending(token: string): string | undefined {
    try {
      const p = jwt.verify(token, env.auth.jwtSecret) as { sub?: string; twofa?: string };
      return p.twofa === "pending" ? p.sub : undefined;
    } catch {
      return undefined;
    }
  }

  /** Change a user's password after re-verifying the current one. Returns false
   *  if the current password is wrong (or the account has no password set). */
  async changePassword(userId: string, current: string, next: string): Promise<boolean> {
    const hash = await this.store.getPasswordHash(userId);
    if (!hash || !(await bcrypt.compare(current, hash))) return false;
    await this.store.setUserPassword(userId, next);
    return true;
  }
}
