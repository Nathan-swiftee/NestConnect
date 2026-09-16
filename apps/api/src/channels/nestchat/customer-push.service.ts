import { Injectable, Logger } from "@nestjs/common";
import type { Conversation } from "@ding/schemas";
import { Store } from "../../data/store";
import {
  FCM_SERVICE_ACCOUNT_FIELD,
  FcmSender,
  isDeadToken,
  parseServiceAccount,
  type FcmCredential,
} from "./fcm";
import { VisitorBus } from "./visitor-bus";

/** The Android notification channel the host app is expected to create. */
const ANDROID_CHANNEL = "nest_messages";

/** A chat notification is worthless an hour late. */
const TTL_SECONDS = 30 * 60;

/** Per conversation: at most this many pushes in the window. A thread where an
 *  agent sends six short lines in a row is one buzz, not six. */
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;

/** Notification bodies are a preview, not the message. Long enough to be worth
 *  reading on a lock screen, short enough not to be the whole reply. */
const PREVIEW_MAX = 180;

export interface CustomerPushRequest {
  conversation: Conversation;
  /** The agent's name — what the customer sees as the notification's title. */
  authorName?: string;
  body: string;
  /** Used for the preview when the reply is a file with no words. */
  attachmentCount?: number;
}

/**
 * Ringing a customer's phone when an agent replies.
 *
 * The opposite direction from {@link PushService}, and a different set of
 * rules. An agent has preferences, quiet hours and a dozen conversations; a
 * customer has one thread, no settings screen of ours, and one question — did
 * anybody answer me. So there is no preference to consult and nothing to mute:
 * a customer who does not want this turns notifications off for the app itself,
 * in the OS, which is where they would look for it anyway.
 *
 * What is left is the one rule that actually matters, and the reason
 * {@link VisitorBus.isWatching} exists: do not push a message that is already
 * on screen. A reply arriving live in an open chat *and* as a banner over the
 * top of it is the thing that makes people turn notifications off for good.
 *
 * Credentials are per channel because the push belongs to the business's own
 * app — their Firebase project, their app icon, their notification. We are
 * borrowing their tray, so a channel with no service account simply does not
 * push, rather than falling back to some project of ours the customer has
 * never heard of.
 */
@Injectable()
export class CustomerPushService {
  private readonly logger = new Logger(CustomerPushService.name);
  /** Overridable so the delivery-decision check can run without reaching
   *  Google — the rules above are the part worth testing, and they are decided
   *  before a single byte leaves the process. */
  protected readonly fcm: FcmSender = new FcmSender();
  /** conversationId → recent send timestamps. */
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly store: Store,
    private readonly bus: VisitorBus,
  ) {}

  /** Queue a notification. Returns immediately: the reply is already stored and
   *  already on its way to any open widget, and a slow FCM call must not sit in
   *  front of that. */
  notify(req: CustomerPushRequest): void {
    void this.deliver(req).catch((err) => this.logger.warn(`Customer push failed: ${String(err)}`));
  }

  /** The same work, awaited — for tests and for a settings "send a test push". */
  async notifyAndWait(req: CustomerPushRequest): Promise<{ sent: number; failed: number; skipped: string }> {
    return this.deliver(req);
  }

  private async deliver(
    req: CustomerPushRequest,
  ): Promise<{ sent: number; failed: number; skipped: string }> {
    const none = (skipped: string) => ({ sent: 0, failed: 0, skipped });
    const { conversation } = req;
    if (!conversation.contact?.id) return none("no_contact");

    // Cheapest first: the customer looking at the chat right now is both the
    // commonest case and the one where a banner does actual harm.
    if (await this.bus.isWatching(conversation.id)) return none("watching");
    if (!this.withinRate(conversation.id)) return none("rate_limited");

    const devices = await this.store.customerDevicesFor(conversation.contact.id, conversation.inboxId);
    if (!devices.length) return none("no_devices");

    const credential = await this.credentialFor(conversation.inboxId);
    if (!credential) return none("not_configured");

    const collapseKey = `nest:${conversation.id}`;
    const title = req.authorName?.trim() || "New message";
    const body = preview(req.body, req.attachmentCount ?? 0);

    let sent = 0;
    let failed = 0;
    await Promise.all(
      devices.map(async (device) => {
        const result = await this.fcm.send(credential, {
          token: device.token,
          title,
          body,
          // Everything the host app needs to open the right thread on tap.
          // FCM insists on string values, so nothing here may be a number.
          data: {
            source: "nestconnect",
            conversationId: conversation.id,
            inboxId: conversation.inboxId,
          },
          collapseKey,
          channelId: ANDROID_CHANNEL,
          ttlSeconds: TTL_SECONDS,
        });
        if (result.ok) {
          sent++;
          return;
        }
        failed++;
        if (isDeadToken(result.error)) {
          // The app is gone from this handset. Stop addressing it — otherwise
          // every future reply spends a round trip failing the same way.
          await this.store
            .disableCustomerDevice(device.token, result.error ?? "unregistered")
            .catch(() => undefined);
          return;
        }
        this.logger.debug(`FCM ${result.error ?? "error"}: ${result.message ?? ""}`);
      }),
    );

    if (sent) this.mark(conversation.id);
    return { sent, failed, skipped: "" };
  }

  /** The business's Firebase project for this channel, or null if unset or
   *  unusable. Null rather than a throw: a channel with no push configured is
   *  an ordinary state, not an error. */
  private async credentialFor(inboxId: string): Promise<FcmCredential | null> {
    const config = await this.store.getInboxConfig(inboxId);
    return parseServiceAccount(config?.[FCM_SERVICE_ACCOUNT_FIELD]);
  }

  private withinRate(conversationId: string): boolean {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    const hits = (this.recent.get(conversationId) ?? []).filter((t) => t > cutoff);
    return hits.length < RATE_LIMIT;
  }

  private mark(conversationId: string): void {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    const hits = (this.recent.get(conversationId) ?? []).filter((t) => t > cutoff);
    hits.push(Date.now());
    this.recent.set(conversationId, hits);
    // The map would otherwise hold a row per conversation ever notified. Anything
    // whose window has passed is no longer evidence of anything.
    if (this.recent.size > 5000) {
      for (const [id, times] of this.recent) {
        if (!times.some((t) => t > cutoff)) this.recent.delete(id);
      }
    }
  }
}

/**
 * What the lock screen says.
 *
 * A reply with no words is a file, and "" on a lock screen reads as a bug — so
 * an empty body becomes a description of what arrived rather than nothing.
 */
export function preview(body: string, attachmentCount: number): string {
  const text = body.trim().replace(/\s+/g, " ");
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
  if (attachmentCount > 1) return `Sent ${attachmentCount} files`;
  if (attachmentCount === 1) return "Sent a file";
  return "New message";
}
