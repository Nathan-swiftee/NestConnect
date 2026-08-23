import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Inbox } from "@ding/schemas";
import { env } from "../../config/env";
import { Store, type AttachmentInput } from "../../data/store";
import { MediaService } from "../../storage/media.service";
import { IngestService } from "../ingest.service";
import {
  GMAIL_CONFIG,
  GOOGLE_PUBSUB_TOPIC_KEY,
  GoogleOAuthService,
} from "./google-oauth.service";
import {
  collectAttachmentParts,
  extractPlainText,
  extractHtml,
  gmail,
  GmailApiError,
  headerValue,
  parseAddress,
  parseAddressList,
  threadRefs,
} from "./gmail-api";

/** Re-arm a Gmail watch once it's within this window of expiring. */
const WATCH_RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

/**
 * Pulls new mail from every connected Gmail inbox into the shared inbound
 * pipeline. Runs on a timer (polling) and can also be poked for a single inbox
 * by the Pub/Sub push webhook. Incremental via Gmail's history cursor, so each
 * pass only fetches messages added since the last sync.
 */
@Injectable()
export class GmailSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GmailSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly ingest: IngestService,
    private readonly google: GoogleOAuthService,
    private readonly media: MediaService,
  ) {}

  /** True when there is nothing to poll (mock mode or polling switched off). */
  get isPollingDisabled(): boolean {
    return this.google.isMock || env.gmail.pollSeconds <= 0;
  }

  onApplicationBootstrap(): void {
    if (this.isPollingDisabled) {
      this.logger.log(
        this.google.isMock
          ? "Gmail polling disabled (mock mode)"
          : "Gmail background polling disabled (GMAIL_POLL_SECONDS=0)",
      );
      return;
    }
    // With Redis, polling runs as a single cluster-wide repeatable queue job
    // (see BullOutboundQueue) instead of a fragile per-node timer.
    if (env.usingRedis) {
      this.logger.log("Gmail polling handled by the durable queue (Redis)");
      return;
    }
    // No Redis (dev/self-host-lite): fall back to an in-process safety-net timer.
    // It skips inboxes with an active push subscription (those arrive instantly).
    this.timer = setInterval(
      () => void this.syncAll({ skipPushCovered: true }),
      env.gmail.pollSeconds * 1000,
    );
    // Don't keep the process alive just for the poll timer.
    this.timer.unref?.();
    this.logger.log(`Gmail background poll every ${env.gmail.pollSeconds}s (skips push-covered inboxes)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Sync every connected Gmail inbox once. Guards against overlapping runs.
   * A manual refresh syncs all inboxes; the background timer passes
   * `skipPushCovered` so inboxes served by push aren't polled needlessly.
   */
  async syncAll(opts?: { skipPushCovered?: boolean }): Promise<number> {
    if (this.google.isMock) return 0; // no real Gmail to pull in mock mode
    if (this.running) return 0;
    this.running = true;
    let synced = 0;
    try {
      for (const { inbox, config } of await this.gmailInboxes()) {
        if (opts?.skipPushCovered && this.hasActiveWatch(config)) continue; // push covers it
        try {
          await this.syncInbox(inbox, config);
          synced++;
        } catch (err) {
          this.logger.warn(`Gmail sync failed for ${inbox.handle}: ${message(err)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return synced;
  }

  /** True while the inbox has a live Gmail push subscription (watch). */
  private hasActiveWatch(config: Record<string, string>): boolean {
    return Number(config[GMAIL_CONFIG.watchExpiry] ?? 0) > Date.now();
  }

  /** Sync a single inbox by connected address (used by the push webhook). */
  async syncInboxByEmail(emailAddress: string): Promise<void> {
    if (this.google.isMock) return;
    const want = emailAddress.trim().toLowerCase();
    const match = (await this.gmailInboxes()).find(
      ({ inbox, config }) =>
        (config[GMAIL_CONFIG.email] || inbox.handle).toLowerCase() === want,
    );
    if (!match) {
      this.logger.warn(`Push for ${emailAddress} but no matching Gmail inbox`);
      return;
    }
    await this.syncInbox(match.inbox, match.config);
  }

  /**
   * Record the current history cursor for a freshly-connected inbox so the next
   * sync only picks up mail that arrives from now on (no full-mailbox backfill).
   */
  async establishBaseline(inbox: Inbox, accessToken?: string): Promise<string | undefined> {
    try {
      const token = accessToken ?? (await this.tokenFor(inbox));
      const profile = await gmail.getProfile(token);
      await this.store.updateInbox(inbox.id, {
        channelConfig: { [GMAIL_CONFIG.historyId]: profile.historyId },
      });
      this.logger.log(`Gmail baseline historyId ${profile.historyId} for ${inbox.handle}`);
      return profile.historyId;
    } catch (err) {
      this.logger.warn(`Gmail baseline failed for ${inbox.handle}: ${message(err)}`);
      return undefined;
    }
  }

  /* ------------------------------- internals ------------------------------ */

  private async gmailInboxes(): Promise<Array<{ inbox: Inbox; config: Record<string, string> }>> {
    const out: Array<{ inbox: Inbox; config: Record<string, string> }> = [];
    for (const inbox of await this.store.listInboxes()) {
      if (inbox.type !== "email") continue;
      const config = await this.store.getInboxConfig(inbox.id);
      if (config?.[GMAIL_CONFIG.provider] === "gmail") out.push({ inbox, config });
    }
    return out;
  }

  private async tokenFor(inbox: Inbox): Promise<string> {
    const config = (await this.store.getInboxConfig(inbox.id)) ?? {};
    return this.google.accessTokenForInbox(inbox, config);
  }

  private async syncInbox(inbox: Inbox, config: Record<string, string>): Promise<void> {
    const token = await this.google.accessTokenForInbox(inbox, config);

    const startHistoryId = config[GMAIL_CONFIG.historyId];
    if (!startHistoryId) {
      await this.establishBaseline(inbox, token);
      return;
    }

    const ids = new Set<string>();
    let newestHistoryId = startHistoryId;
    let pageToken: string | undefined;
    do {
      let page;
      try {
        page = await gmail.historyList(token, startHistoryId, pageToken);
      } catch (err) {
        // A 404 means our cursor is older than Gmail retains — rebaseline.
        if (err instanceof GmailApiError && err.status === 404) {
          await this.establishBaseline(inbox, token);
          return;
        }
        throw err;
      }
      for (const record of page.history ?? []) {
        for (const added of record.messagesAdded ?? []) ids.add(added.message.id);
      }
      if (page.historyId) newestHistoryId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);

    let ingested = 0;
    for (const id of ids) {
      try {
        if (await this.ingestOne(inbox, config, token, id)) ingested++;
      } catch (err) {
        this.logger.warn(`Gmail ingest of message ${id} failed: ${message(err)}`);
      }
    }

    // Advance the cursor so we don't re-scan this window next time.
    await this.store.updateInbox(inbox.id, {
      channelConfig: { [GMAIL_CONFIG.historyId]: newestHistoryId },
    });
    if (ingested) this.logger.log(`Gmail: ingested ${ingested} new message(s) for ${inbox.handle}`);

    // If push is configured, keep the watch alive (it lapses after ~7 days).
    await this.maybeRenewWatch(inbox, config, token);
  }

  /**
   * Arm (or re-arm) a Gmail push `watch` when the org has a Pub/Sub topic set.
   * No-op when no topic is configured — polling remains the delivery path.
   */
  async armWatch(inbox: Inbox, accessToken?: string): Promise<void> {
    const topic = (await this.store.getAppSetting(inbox.orgId, GOOGLE_PUBSUB_TOPIC_KEY))?.trim();
    if (!topic) return;
    try {
      const token = accessToken ?? (await this.tokenFor(inbox));
      const result = await gmail.watch(token, topic);
      await this.store.updateInbox(inbox.id, {
        channelConfig: {
          [GMAIL_CONFIG.watchExpiry]: result.expiration,
          // watch returns the current historyId; seed it if we have none yet.
          ...(result.historyId ? { [GMAIL_CONFIG.historyId]: result.historyId } : {}),
        },
      });
      this.logger.log(`Gmail watch armed for ${inbox.handle} (expires ${result.expiration})`);
    } catch (err) {
      this.logger.warn(`Gmail watch failed for ${inbox.handle}: ${message(err)}`);
    }
  }

  private async maybeRenewWatch(
    inbox: Inbox,
    config: Record<string, string>,
    accessToken: string,
  ): Promise<void> {
    const topic = (await this.store.getAppSetting(inbox.orgId, GOOGLE_PUBSUB_TOPIC_KEY))?.trim();
    if (!topic) return; // push not configured
    const expiry = Number(config[GMAIL_CONFIG.watchExpiry] ?? 0);
    if (expiry && Date.now() < expiry - WATCH_RENEW_BEFORE_MS) return; // still fresh
    await this.armWatch(inbox, accessToken);
  }

  /** Fetch, filter, dedup, and ingest one Gmail message. Returns true if ingested. */
  private async ingestOne(
    inbox: Inbox,
    config: Record<string, string>,
    token: string,
    id: string,
  ): Promise<boolean> {
    const msg = await gmail.getMessage(token, id);
    const isSent = msg.labelIds?.includes("SENT") ?? false;
    const isInbox = msg.labelIds?.includes("INBOX") ?? false;
    // Only received (INBOX) and sent (SENT) mail matter — ignore drafts etc.
    if (!isSent && !isInbox) return false;

    // Nest's own outbound (via Postmark or Gmail) carries this marker header, which
    // Gmail preserves. Its Sent copy is the message Nest already stored, so skip it
    // — otherwise it re-appears as a duplicate (Gmail rewrites the Message-ID it
    // assigns, so the Message-ID dedup below can't catch a Gmail-sent copy).
    if (isSent && headerValue(msg, "X-Ding-Origin") === "nest") return false;

    const messageId = headerValue(msg, "Message-ID");
    // Idempotency: skip anything we've already stored (belt-and-suspenders with the
    // marker above; also dedups a genuine Gmail-direct send seen twice).
    if (messageId && (await this.store.findConversationByMessageChannelIds([messageId]))) {
      return false;
    }

    // A reply sent straight from Gmail (SENT, not a received message) → record it
    // as outbound on its existing thread so the conversation stays complete.
    if (isSent) {
      const outAtts = await this.fetchAttachments(token, id, msg);
      const { name: senderName } = parseAddress(headerValue(msg, "From") ?? "");
      const res = await this.ingest.ingestOutboundEmail({
        subject: headerValue(msg, "Subject"),
        text: extractPlainText(msg),
        html: extractHtml(msg),
        messageId,
        references: threadRefs(msg),
        threadId: msg.threadId,
        authorName: senderName || "Gmail",
        // Who it actually went to, so the reply is filed on that customer's
        // thread rather than whichever conversation shares the References chain.
        recipients: [
          ...parseAddressList(headerValue(msg, "To")),
          ...parseAddressList(headerValue(msg, "Cc")),
        ],
        attachments: outAtts.length ? outAtts : undefined,
      });
      return !!res;
    }

    const { email: from, name: fromName } = parseAddress(headerValue(msg, "From") ?? "");
    const selfAddress = (config[GMAIL_CONFIG.email] || inbox.handle).toLowerCase();
    if (!from || from === selfAddress) return false;

    const attachments = await this.fetchAttachments(token, id, msg);

    await this.ingest.ingestEmail({
      toAddress: selfAddress,
      from,
      fromName,
      subject: headerValue(msg, "Subject"),
      text: extractPlainText(msg),
      html: extractHtml(msg),
      messageId,
      references: threadRefs(msg),
      // Gmail groups a reply into a thread by its id; persist it so we can reply
      // back into the same thread instead of starting a new one.
      threadId: msg.threadId,
      attachments: attachments.length ? attachments : undefined,
    });
    return true;
  }

  /** Download + store any real attachment parts on a Gmail message. */
  private async fetchAttachments(
    token: string,
    messageId: string,
    msg: Parameters<typeof collectAttachmentParts>[0],
  ): Promise<AttachmentInput[]> {
    const out: AttachmentInput[] = [];
    for (const part of collectAttachmentParts(msg)) {
      try {
        const fetched = await gmail.getAttachment(token, messageId, part.attachmentId);
        if (!fetched.data) continue;
        const bytes = Buffer.from(fetched.data, "base64url");
        out.push(await this.media.store(bytes, { filename: part.filename, mime: part.mime }));
      } catch (err) {
        this.logger.warn(`Gmail attachment ${part.filename} failed: ${message(err)}`);
      }
    }
    return out;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
