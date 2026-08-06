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
import { buildMime, gmail } from "./gmail-api";

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
    const inboxId = params.conversation.inboxId;
    const config = await this.store.getInboxConfig(inboxId);
    if (!config || config[GMAIL_CONFIG.provider] !== "gmail") {
      return { ok: false, error: "Gmail inbox is not connected" };
    }
    const fromAddress = config[GMAIL_CONFIG.email] || env.email.from;
    const domain = fromAddress.split("@")[1] || env.email.domain;
    const messageId = `<ding.${params.conversation.id}.${Date.now()}@${domain}>`;
    const subject = this.replySubject(params.context?.subject);

    if (this.google.isMock) {
      this.logger.log(`[mock] Gmail send → ${params.to} · "${subject}"`);
      return { ok: true, channelMsgId: messageId };
    }

    try {
      const inbox = await this.store.getInbox(inboxId);
      if (!inbox) return { ok: false, error: "Gmail inbox not found" };
      const accessToken = await this.google.accessTokenForInbox(inbox, config);
      const raw = buildMime({
        from: fromAddress,
        fromName: inbox.name,
        to: params.to,
        toName: params.context?.toName,
        subject,
        body: params.body,
        messageId,
        inReplyTo: params.context?.inReplyTo,
        // A reply's References should chain the message it answers.
        references: params.context?.inReplyTo,
      });
      await gmail.send(accessToken, raw);
      return { ok: true, channelMsgId: messageId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private replySubject(subject?: string): string {
    const s = (subject ?? "").trim();
    if (!s) return "Re: your message";
    return /^re:/i.test(s) ? s : `Re: ${s}`;
  }
}
