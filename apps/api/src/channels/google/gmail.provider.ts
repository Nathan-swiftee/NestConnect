import { Injectable, Logger } from "@nestjs/common";
import type { ChannelType } from "@ding/schemas";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import {
  ChannelProvider,
  type SendParams,
  type SendResult,
  type SupportsContext,
} from "../channel-provider";
import { GMAIL_CONFIG, GoogleOAuthService } from "./google-oauth.service";
import { buildMime, gmail, GmailApiError } from "./gmail-api";
import { textToHtml } from "../email/html-sanitize";
import { appendSignature, subjectLine } from "../email/email.provider";

/**
 * Sends outbound email through a Gmail-connected inbox using the Gmail API and
 * that inbox's stored OAuth token (refreshed on demand). Selected over the
 * generic email provider when the conversation's inbox was connected via Google.
 */
@Injectable()
export class GmailProvider extends ChannelProvider {
  private readonly logger = new Logger(GmailProvider.name);

  constructor(
    private readonly google: GoogleOAuthService,
    private readonly store: Store,
  ) {
    super();
  }

  supports(channel: ChannelType, ctx?: SupportsContext): boolean {
    return channel === "email" && ctx?.provider === "gmail";
  }

  async sendText(params: SendParams): Promise<SendResult> {
    // The sending inbox may differ from the conversation's (cross-channel reply).
    const inboxId = params.inboxId ?? params.conversation.inboxId;
    const config = await this.store.getInboxConfig(inboxId);
    if (!config || config[GMAIL_CONFIG.provider] !== "gmail") {
      return { ok: false, error: "Gmail inbox is not connected" };
    }
    const fromAddress = config[GMAIL_CONFIG.email] || env.email.from;
    const domain = fromAddress.split("@")[1] || env.email.domain;
    const messageId = `<ding.${params.conversation.id}.${Date.now()}@${domain}>`;
    const subject = subjectLine(params.context);
    const attachments = (params.media ?? []).map((m) => ({
      filename: m.filename,
      mime: m.mime,
      bytes: m.bytes,
    }));

    if (this.google.isMock) {
      const extra = attachments.length ? ` (+${attachments.length} attachment)` : "";
      this.logger.log(`[mock] Gmail send → ${params.to} · "${subject}"${extra}`);
      return { ok: true, channelMsgId: messageId };
    }

    try {
      const inbox = await this.store.getInbox(inboxId);
      if (!inbox) return { ok: false, error: "Gmail inbox not found" };
      const accessToken = await this.google.accessTokenForInbox(inbox, config);
      // The sender's signature is appended to the wire body only.
      const { html: htmlBody, text: textBody } = appendSignature(
        params.bodyHtml || textToHtml(params.body),
        params.body,
        params.signatureHtml,
      );
      const raw = buildMime({
        from: fromAddress,
        fromName: inbox.name,
        to: params.to,
        toName: params.context?.toName,
        cc: params.cc,
        bcc: params.bcc,
        subject,
        body: textBody,
        // Rich reply → a text+html alternative; else derive HTML from the text.
        html: htmlBody,
        messageId,
        inReplyTo: params.context?.inReplyTo,
        // A reply's References should chain the message it answers.
        references: params.context?.inReplyTo,
        attachments,
      });
      await gmail.send(accessToken, raw);
      return { ok: true, channelMsgId: messageId };
    } catch (err) {
      if (err instanceof GmailApiError) {
        return { ok: false, error: err.message, errorCode: String(err.status), httpStatus: err.status };
      }
      // Token refresh / network error before any HTTP response — transient.
      return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }

}
