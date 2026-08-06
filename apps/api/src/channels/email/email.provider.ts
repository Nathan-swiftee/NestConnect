import { Injectable, Logger } from "@nestjs/common";
import type { ChannelType } from "@ding/schemas";
import { env } from "../../config/env";
import {
  ChannelProvider,
  type SendParams,
  type SendResult,
  type SupportsContext,
} from "../channel-provider";

/**
 * Email sender. Runs in mock mode until POSTMARK_TOKEN is set. We mint our own
 * RFC Message-ID and set In-Reply-To/References so replies thread back to the
 * right conversation (the Message-ID is stored as the message's channelMsgId).
 */
@Injectable()
export class EmailProvider extends ChannelProvider {
  private readonly logger = new Logger(EmailProvider.name);

  private get isLive(): boolean {
    return Boolean(env.email.postmarkToken);
  }

  supports(channel: ChannelType, ctx?: SupportsContext): boolean {
    // Gmail-connected inboxes are served by the Gmail provider, not Postmark.
    return channel === "email" && ctx?.provider !== "gmail";
  }

  async sendText(params: SendParams): Promise<SendResult> {
    const messageId = `<ding.${params.conversation.id}.${Date.now()}@${env.email.domain}>`;
    const subject = this.replySubject(params.context?.subject);

    if (!this.isLive) {
      this.logger.log(`[mock] Email → ${params.to} · "${subject}"`);
      return { ok: true, channelMsgId: messageId };
    }

    try {
      const headers: Array<{ Name: string; Value: string }> = [{ Name: "Message-ID", Value: messageId }];
      if (params.context?.inReplyTo) {
        headers.push({ Name: "In-Reply-To", Value: params.context.inReplyTo });
        headers.push({ Name: "References", Value: params.context.inReplyTo });
      }
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": env.email.postmarkToken,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          From: env.email.from,
          To: params.to,
          Subject: subject,
          TextBody: params.body,
          MessageStream: "outbound",
          Headers: headers,
        }),
      });
      const json = (await res.json()) as { ErrorCode?: number; Message?: string };
      if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
        return { ok: false, error: json.Message ?? `HTTP ${res.status}` };
      }
      return { ok: true, channelMsgId: messageId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private replySubject(subject?: string): string {
    const s = (subject ?? "").trim();
    if (!s) return "Re: your message";
    return /^re:/i.test(s) ? s : `Re: ${s}`;
  }
}
