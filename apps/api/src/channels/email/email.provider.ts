import { Injectable, Logger } from "@nestjs/common";
import type { ChannelType } from "@ding/schemas";
import { env } from "../../config/env";
import {
  ChannelProvider,
  type SendParams,
  type SendResult,
  type SupportsContext,
} from "../channel-provider";
import { textToHtml } from "./html-sanitize";

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
      // No Postmark token → email sending isn't configured. Fail honestly so the
      // agent sees it; only the explicit dev flag fakes a successful send.
      if (!env.mockMessaging) {
        return {
          ok: false,
          retryable: false,
          error: "Email sending is not configured (missing Postmark token)",
          errorCode: "not_connected",
        };
      }
      this.logger.log(`[mock] Email → ${params.to} · "${subject}"`);
      return { ok: true, channelMsgId: messageId };
    }

    try {
      const headers: Array<{ Name: string; Value: string }> = [{ Name: "Message-ID", Value: messageId }];
      if (params.context?.inReplyTo) {
        headers.push({ Name: "In-Reply-To", Value: params.context.inReplyTo });
        headers.push({ Name: "References", Value: params.context.inReplyTo });
      }
      const attachments = (params.media ?? []).map((m) => ({
        Name: m.filename,
        Content: m.bytes.toString("base64"),
        ContentType: m.mime,
      }));
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
          ...(params.cc?.length ? { Cc: params.cc.join(", ") } : {}),
          ...(params.bcc?.length ? { Bcc: params.bcc.join(", ") } : {}),
          Subject: subject,
          TextBody: params.body,
          // Rich reply → its HTML; else derive a simple HTML alternative.
          HtmlBody: params.bodyHtml || textToHtml(params.body),
          MessageStream: "outbound",
          Headers: headers,
          ...(attachments.length ? { Attachments: attachments } : {}),
        }),
      });
      const json = (await res.json()) as { ErrorCode?: number; Message?: string };
      if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
        return {
          ok: false,
          error: json.Message ?? `HTTP ${res.status}`,
          errorCode: json.ErrorCode != null ? String(json.ErrorCode) : undefined,
          httpStatus: res.status,
        };
      }
      return { ok: true, channelMsgId: messageId };
    } catch (err) {
      // Network/transport error before any HTTP response — transient, worth a retry.
      return { ok: false, error: String(err), retryable: true };
    }
  }

  private replySubject(subject?: string): string {
    const s = (subject ?? "").trim();
    if (!s) return "Re: your message";
    return /^re:/i.test(s) ? s : `Re: ${s}`;
  }
}
