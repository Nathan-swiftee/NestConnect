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

/** What became of one notification. `skipped` is empty when a send was
 *  actually attempted, and names the rule that stopped it otherwise. */
export interface CustomerPushOutcome {
  sent: number;
  failed: number;
  skipped: string;
}

/**
 * What a test push found.
 *
 * Deliberately more than a boolean. "It didn't work" is what the settings
 * screen could already tell you; the useful answer names which of the three
 * things is wrong — no phone has registered, no key is saved, or Google
 * refused the send and said why.
 */
export interface CustomerPushTest {
  ok: boolean;
  /** Stopped before reaching Google: `no_devices` or `not_configured`. */
  reason?: string;
  /** FCM's own code, e.g. `SENDER_ID_MISMATCH`, when it did reach Google. */
  error?: string;
  /** That code, in a sentence somebody can act on. */
  detail: string;
  /** Which handset it aimed at, for a business with several. */
  platform?: string;
}

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
    void this.deliver(req)
      .then((result) => this.record(req, result))
      .catch((err) => this.logger.warn(`Customer push failed: ${String(err)}`));
  }

  /**
   * Say what became of a notification nobody is awaiting.
   *
   * Every branch of {@link deliver} used to return its reason to a caller that
   * threw it away, so "the push never arrived" was indistinguishable in the
   * logs from "no push was ever attempted" — and answering it meant reading
   * the source and guessing which of five silent skips had been taken.
   *
   * Two of those skips are the system working: the customer is reading the
   * chat right now, or an agent sent six lines in a row. Those are debug. The
   * rest mean somebody set push up and it is not working, and they are warned
   * about — but only once there is a device registered, because a channel with
   * no app attached is a website widget, and warning on every reply it ever
   * sends would bury the channels that have a real problem.
   */
  private record(req: CustomerPushRequest, result: CustomerPushOutcome): void {
    const where = `conversation=${req.conversation.id} inbox=${req.conversation.inboxId}`;
    if (!result.skipped) {
      this.logger.debug(`Customer push sent=${result.sent} failed=${result.failed} ${where}`);
      return;
    }
    if (result.skipped === "not_configured") {
      this.logger.warn(
        `Customer push skipped: this channel has a registered device but no Firebase service account — ${where}`,
      );
      return;
    }
    this.logger.debug(`Customer push skipped: ${result.skipped} ${where}`);
  }

  /** The same work, awaited — for tests and for a settings "send a test push". */
  async notifyAndWait(req: CustomerPushRequest): Promise<CustomerPushOutcome> {
    return this.deliver(req);
  }

  /**
   * Ring the last phone that registered on this channel, and report back.
   *
   * "Did it arrive?" is the only question worth asking while setting push up,
   * and no amount of inspecting configuration answers it: a service account
   * can be present, valid, and still belong to a different Firebase project
   * from the app — which Google reports as `SENDER_ID_MISMATCH` on the send
   * and nowhere else. So this sends a real notification to a real handset.
   *
   * It aims at the most recently registered device rather than asking for one,
   * because whoever is pressing the button has the phone in their hand and
   * does not know a contact id. The rate limiter and the is-watching rule are
   * both skipped: a test the customer's open chat can silently swallow would
   * be worse than no test at all.
   */
  async sendTest(inboxId: string): Promise<CustomerPushTest> {
    const device = await this.store.latestCustomerDeviceFor(inboxId);
    if (!device) {
      return {
        ok: false,
        reason: "no_devices",
        detail:
          "No phone has registered for notifications on this channel yet. Open the app, sign in, " +
          "and make sure it calls registerPushToken with its Firebase token.",
      };
    }

    const credential = await this.credentialFor(inboxId);
    if (!credential) {
      return {
        ok: false,
        reason: "not_configured",
        platform: device.platform,
        detail: "No Firebase service-account key is saved for this channel. Add one above.",
      };
    }

    const result = await this.fcm.send(credential, {
      token: device.token,
      title: "Nest Connect",
      body: "Notifications are working on this device.",
      data: { source: "nestconnect", test: "1" },
      channelId: ANDROID_CHANNEL,
      ttlSeconds: TTL_SECONDS,
    });

    if (result.ok) {
      this.logger.debug(`Customer push test delivered to ${device.platform} on inbox=${inboxId}`);
      return { ok: true, platform: device.platform, detail: "Sent. It should arrive within a second or two." };
    }

    this.logger.warn(
      `Customer push test rejected by FCM: ${result.error ?? "error"} (inbox=${inboxId})` +
        (result.message ? ` ${result.message}` : ""),
    );
    if (isDeadToken(result.error)) {
      await this.store
        .disableCustomerDevice(device.token, result.error ?? "unregistered")
        .catch(() => undefined);
    }
    return {
      ok: false,
      error: result.error,
      platform: device.platform,
      detail: explainFcmError(result.error, result.message),
    };
  }

  private async deliver(req: CustomerPushRequest): Promise<CustomerPushOutcome> {
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
          this.logger.debug(
            `Customer device disabled (${result.error ?? "unregistered"}): the app is gone from ` +
              `this handset — inbox=${conversation.inboxId}`,
          );
          return;
        }
        // Warn, not debug. This is the line that says why a phone stayed
        // quiet, and it is worth nothing if it only appears at a level
        // nobody thinks to ask for.
        this.logger.warn(
          `Customer push rejected by FCM: ${result.error ?? "error"} — ${explainFcmError(result.error)} ` +
            `(conversation=${conversation.id} inbox=${conversation.inboxId})` +
            (result.message ? ` ${result.message}` : ""),
        );
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
 * Turn an FCM error code into something the person reading it can act on.
 *
 * These codes are the whole diagnosis and none of the explanation.
 * `SENDER_ID_MISMATCH` in particular is the commonest way for a correctly
 * configured-looking channel to be silently broken — a valid key, a valid
 * token, and two different Firebase projects — and reads like a bug in us
 * until somebody says what it means.
 */
export function explainFcmError(error: string | undefined, message?: string): string {
  switch (error) {
    case "SENDER_ID_MISMATCH":
      return (
        "the phone's token was issued by a different Firebase project from the service-account key " +
        "saved here. Check that project_id in the key matches the app's google-services.json."
      );
    case "UNREGISTERED":
    case "NOT_FOUND":
      return "the app has been uninstalled from that handset, or its token has expired.";
    case "INVALID_ARGUMENT":
      return "Google rejected the message itself — usually a malformed device token.";
    case "auth":
      return (
        "the service-account key was refused by Google. It may have been revoked, or the " +
        "Firebase Cloud Messaging API may be disabled on that project."
      );
    case "PERMISSION_DENIED":
      return "that service account is not allowed to send for this Firebase project.";
    case "QUOTA_EXCEEDED":
      return "the Firebase project is over its sending quota. Try again shortly.";
    case "UNAVAILABLE":
    case "INTERNAL":
      return "Google's push service is having a moment. Nothing is wrong at either end; try again.";
    case "transport":
      return "we could not reach Google at all — a network or firewall problem on our side.";
    default:
      return message?.trim() || "Google refused the send without saying why.";
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
