import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  DEFAULT_PUSH_PREFERENCES,
  pushPreferencesSchema,
  type PushPreferences,
  type UpdatePushPreferencesInput,
} from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { PushProvider, type PushMessage } from "./push.provider";

/** What a push is *about*. Each maps to a preference, an Android notification
 *  channel, and whether quiet hours may hold it back. */
export type PushKind = "message" | "team_message" | "mention" | "assignment" | "reminder" | "test";

/** One thing worth telling someone about, before policy is applied. */
export interface PushRequest {
  /** Who might be told. Filtered by preference, presence and device state. */
  userIds: string[];
  kind: PushKind;
  title: string;
  body: string;
  conversationId?: string;
  /** Whoever caused this. Never notified about their own action. */
  actorUserId?: string;
}

/** Android channels, one per class, so a person can silence "every message" and
 *  still be reachable for a direct mention. Mandatory on Android 8+. */
const ANDROID_CHANNEL: Record<PushKind, string> = {
  message: "messages",
  team_message: "messages",
  mention: "mentions",
  assignment: "assignments",
  reminder: "reminders",
  test: "messages",
};

/** Which preference each kind answers to. */
const PREFERENCE: Record<PushKind, keyof PushPreferences | null> = {
  message: "assigned",
  team_message: "teamInbound",
  mention: "mentions",
  assignment: "assignments",
  reminder: "reminders",
  // A test push is a deliberate act by the person receiving it: policy would
  // only make "I pressed the button and nothing happened" ambiguous.
  test: null,
};

/** Quiet hours hold back the routine; a direct mention still gets through. */
const IGNORES_QUIET_HOURS: ReadonlySet<PushKind> = new Set<PushKind>(["mention", "test"]);

/** A chat notification is worthless an hour late — don't let the OS deliver it. */
const TTL_SECONDS = 30 * 60;

/** Per user, per conversation: at most this many pushes in the window. A busy
 *  thread should not fire twenty banners a minute. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

/** Receipts are polled in one sweep rather than a timer per send. */
const RECEIPT_SWEEP_MS = 60_000;

interface PendingReceipt {
  ticketId: string;
  pushToken: string;
  readyAt: number;
}

/**
 * Push policy: who actually gets told, and what the notification looks like.
 *
 * The provider knows how to reach a phone. This knows whether it should — which
 * is the part that decides whether people keep notifications turned on. The
 * rules, in order:
 *
 *  1. Never the actor. Being notified about your own message is noise.
 *  2. Never for a thread that's open in front of them (see `isViewing`).
 *  3. Only what they asked for (per-user preferences; team-inbound off by default).
 *  4. Quiet hours, except for a direct mention.
 *  5. Rate-limited per conversation, and collapsed per conversation so five
 *     messages in one chat replace each other instead of stacking.
 *
 * Sending is deliberately fire-and-forget: {@link notify} returns as soon as the
 * work is scheduled, because a push failing must never fail a message send.
 */
@Injectable()
export class PushService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** ticketId → what it was for, held until its receipt is due to be readable. */
  private readonly pending: PendingReceipt[] = [];
  /** `${userId}:${conversationId}` → recent send timestamps. */
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly store: Store,
    private readonly provider: PushProvider,
    private readonly realtime: RealtimeGateway,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweepReceipts(), RECEIPT_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ---- preferences ---- */

  /** A user's preferences, with defaults filled in for anything unset. Unparsable
   *  stored JSON falls back to the defaults rather than failing the send. */
  async preferences(userId: string): Promise<PushPreferences> {
    const raw = await this.store.getPushPrefs(userId);
    if (!raw) return DEFAULT_PUSH_PREFERENCES;
    try {
      return pushPreferencesSchema.parse(JSON.parse(raw));
    } catch {
      this.logger.warn(`Ignoring unreadable push preferences for ${userId}`);
      return DEFAULT_PUSH_PREFERENCES;
    }
  }

  /** Patch a user's preferences — the client sends only what changed. */
  async updatePreferences(userId: string, patch: UpdatePushPreferencesInput): Promise<PushPreferences> {
    const next = pushPreferencesSchema.parse({ ...(await this.preferences(userId)), ...patch });
    await this.store.setPushPrefs(userId, JSON.stringify(next));
    return next;
  }

  /* ---- sending ---- */

  /** Queue a notification. Returns immediately; delivery happens off the caller's
   *  path so a slow or failing push never delays a message. */
  notify(req: PushRequest): void {
    void this.deliver(req).catch((err) => this.logger.warn(`Push delivery failed: ${String(err)}`));
  }

  /** The same work, awaited — for the Settings "send a test" button, which needs
   *  to report what actually happened. */
  async notifyAndWait(req: PushRequest): Promise<{ sent: number; failed: number }> {
    return this.deliver(req);
  }

  private async deliver(req: PushRequest): Promise<{ sent: number; failed: number }> {
    // Rule 1: never the actor.
    const candidates = req.userIds.filter((id) => id && id !== req.actorUserId);
    if (!candidates.length) return { sent: 0, failed: 0 };

    const recipients: string[] = [];
    for (const userId of new Set(candidates)) {
      if (await this.shouldNotify(userId, req)) recipients.push(userId);
    }
    if (!recipients.length) return { sent: 0, failed: 0 };

    const devices = await this.store.devicesForUsers(recipients);
    if (!devices.length) return { sent: 0, failed: 0 };

    const messages: PushMessage[] = devices.map((d) => ({
      to: d.pushToken,
      title: req.title,
      body: req.body,
      data: {
        kind: req.kind,
        ...(req.conversationId ? { conversationId: req.conversationId } : {}),
      },
      channelId: ANDROID_CHANNEL[req.kind],
      // One key per conversation: five messages in a chat become one entry in the
      // tray rather than five banners.
      ...(req.conversationId ? { collapseKey: `conversation:${req.conversationId}` } : {}),
      priority: "high" as const,
      ttlSeconds: TTL_SECONDS,
    }));

    const results = await this.provider.send(messages);
    const readyAt = Date.now() + env.push.receiptDelaySeconds * 1000;
    let sent = 0;
    let failed = 0;
    for (const r of results) {
      if (r.ok && r.ticketId) {
        sent++;
        this.pending.push({ ticketId: r.ticketId, pushToken: r.to, readyAt });
        continue;
      }
      failed++;
      // A token the provider already knows is dead should stop being used now,
      // rather than waiting for a receipt that will say the same thing.
      if (r.error === "DeviceNotRegistered") await this.store.disableDevice(r.to, r.error);
      else this.logger.warn(`Push to ${r.to.slice(0, 12)}… failed: ${r.error ?? "?"} ${r.message ?? ""}`.trim());
    }
    return { sent, failed };
  }

  /** Rules 2–5, for one person. */
  private async shouldNotify(userId: string, req: PushRequest): Promise<boolean> {
    const prefs = await this.preferences(userId);

    const pref = PREFERENCE[req.kind];
    if (pref && !prefs[pref]) return false;

    if (!IGNORES_QUIET_HOURS.has(req.kind) && this.inQuietHours(prefs)) return false;

    // Rule 2 last of the cheap checks — it's the only one that hits the socket
    // adapter, and there's no point paying for it if a preference already said no.
    if (req.conversationId && (await this.realtime.isViewing(userId, req.conversationId))) return false;

    return this.withinRateLimit(userId, req.conversationId);
  }

  private withinRateLimit(userId: string, conversationId?: string): boolean {
    if (!conversationId) return true;
    const key = `${userId}:${conversationId}`;
    const now = Date.now();
    const hits = (this.recent.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT) return false;
    hits.push(now);
    this.recent.set(key, hits);
    // The map is per-node and bounded by active conversations; trim the tail so a
    // long-running process can't accumulate keys for threads nobody touches.
    if (this.recent.size > 5_000) {
      for (const [k, times] of this.recent) {
        if (!times.some((t) => now - t < RATE_WINDOW_MS)) this.recent.delete(k);
      }
    }
    return true;
  }

  /** Is "now" inside this person's quiet hours? A window whose end is before its
   *  start crosses midnight (22:00 → 07:00), which is the normal case. */
  private inQuietHours(prefs: PushPreferences, now = new Date()): boolean {
    const q = prefs.quietHours;
    if (!q) return false;
    let local = now;
    if (prefs.timezone) {
      // Reading the wall clock in the person's own zone matters: quiet hours set
      // to 22:00 are meaningless if evaluated in the server's UTC.
      try {
        local = new Date(now.toLocaleString("en-US", { timeZone: prefs.timezone }));
      } catch {
        // An unknown zone falls back to server time rather than silencing nothing.
      }
    }
    const minutes = local.getHours() * 60 + local.getMinutes();
    const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const start = toMinutes(q.start);
    const end = toMinutes(q.end);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }

  /* ---- receipts ---- */

  /**
   * Ask the provider what became of messages it accepted.
   *
   * This is not optional bookkeeping: acceptance is not delivery, and
   * `DeviceNotRegistered` — the app was uninstalled — arrives only here. Without
   * this sweep we would push at a dead address forever.
   */
  private async sweepReceipts(): Promise<void> {
    const now = Date.now();
    const due = this.pending.filter((p) => p.readyAt <= now);
    if (!due.length) return;
    // Take them out first: a receipt we fail to read is not worth retrying
    // forever, and the next real send re-establishes the device's health.
    for (const p of due) {
      const i = this.pending.indexOf(p);
      if (i !== -1) this.pending.splice(i, 1);
    }
    const byTicket = new Map(due.map((p) => [p.ticketId, p.pushToken]));
    try {
      for (const receipt of await this.provider.receipts([...byTicket.keys()])) {
        if (receipt.status === "ok") continue;
        const token = byTicket.get(receipt.ticketId);
        if (!token) continue;
        if (receipt.error === "DeviceNotRegistered") {
          await this.store.disableDevice(token, receipt.error);
          this.logger.log("Disabled a device the push service reported unregistered");
        } else {
          this.logger.warn(`Push receipt error: ${receipt.error ?? "?"} ${receipt.message ?? ""}`.trim());
        }
      }
    } catch (err) {
      this.logger.warn(`Receipt sweep failed: ${String(err)}`);
    }
  }
}
