import { Injectable, Logger } from "@nestjs/common";
import type { AttachmentKind, ChannelType, Conversation } from "@ding/schemas";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import {
  ChannelProvider,
  type OutboundMedia,
  type OutboundTemplate,
  type SendParams,
  type SendResult,
} from "../channel-provider";

interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
}

/** WhatsApp media message type for our attachment kind. */
type WaMediaType = "image" | "video" | "audio" | "document" | "sticker";
function waMediaType(kind: AttachmentKind): WaMediaType {
  switch (kind) {
    case "image": return "image";
    case "video": return "video";
    case "voice":
    case "audio": return "audio";
    case "sticker": return "sticker";
    default: return "document";
  }
}
/** Only image/video/document carry a caption on WhatsApp. */
function captionable(type: WaMediaType): boolean {
  return type === "image" || type === "video" || type === "document";
}

/**
 * WhatsApp Business Platform (Cloud API) sender. Credentials are resolved per
 * inbox — a number connected via Meta carries its own token/phone-number-id in
 * channelConfig — falling back to the global env credentials. With neither, the
 * send is mocked so the whole path is exercisable in dev/CI without a live number.
 *
 * Media is sent by first uploading the bytes to `/{phone-number-id}/media` for a
 * media id, then sending a typed (image/video/audio/document) message. WhatsApp
 * carries one media object per message, so multiple attachments become multiple
 * messages; the caption rides the first captionable one.
 */
@Injectable()
export class WhatsAppCloudProvider extends ChannelProvider {
  private readonly logger = new Logger(WhatsAppCloudProvider.name);

  constructor(private readonly store: Store) {
    super();
  }

  supports(channel: ChannelType): boolean {
    return channel === "whatsapp" || channel === "whatsapp_group";
  }

  /** Tell WhatsApp the customer's message was read → blue ticks on their side. */
  async markRead(params: { conversation: Conversation; channelMsgId: string }): Promise<void> {
    await this.readReceipt(params.conversation.inboxId, params.channelMsgId, false);
  }

  /** Show the customer a "typing…" indicator (rides on the read receipt; ~25s). */
  async sendTyping(params: { conversation: Conversation; channelMsgId: string }): Promise<void> {
    await this.readReceipt(params.conversation.inboxId, params.channelMsgId, true);
  }

  /** React to a message with an emoji (empty string removes our reaction). */
  async sendReaction(params: {
    conversation: Conversation;
    channelMsgId: string;
    emoji: string;
  }): Promise<void> {
    const creds = await this.credsFor(params.conversation.inboxId);
    if (!creds) {
      this.logger.log(`[mock] WhatsApp reaction "${params.emoji || "(removed)"}" on ${params.channelMsgId}`);
      return;
    }
    const to = params.conversation.contact.phone;
    if (!to) return;
    await this.postMessage(creds, {
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: params.channelMsgId, emoji: params.emoji },
    });
  }

  /**
   * Mark an inbound message read, optionally with a typing indicator. Meta folds
   * both into one call: `status:read` (+ `typing_indicator` for the "typing…"
   * bubble), keyed on the customer's message id.
   */
  private async readReceipt(inboxId: string, channelMsgId: string, typing: boolean): Promise<void> {
    const what = typing ? "typing indicator" : "read receipt";
    const creds = await this.credsFor(inboxId);
    if (!creds) {
      this.logger.log(`[mock] WhatsApp ${what} for ${channelMsgId}`);
      return;
    }
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: channelMsgId,
          ...(typing ? { typing_indicator: { type: "text" } } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.warn(`WhatsApp ${what} failed (${res.status}): ${detail}`);
      }
    } catch (err) {
      this.logger.warn(`WhatsApp ${what} error: ${String(err)}`);
    }
  }

  async sendText(params: SendParams): Promise<SendResult> {
    // Use the sending inbox (may differ from the conversation's for a
    // cross-channel reply) to resolve this number's credentials.
    const creds = await this.credsFor(params.inboxId ?? params.conversation.inboxId);
    const media = params.media ?? [];
    if (!creds) {
      // No live credentials for this number. In production (and by default) this
      // is a real, non-retryable failure the agent must see; only the explicit
      // dev flag fakes a successful send.
      if (!env.mockMessaging) {
        return {
          ok: false,
          retryable: false,
          error: "WhatsApp number is not connected (missing access token / phone-number-id)",
          errorCode: "not_connected",
        };
      }
      const what = params.template
        ? `template "${params.template.name}" [${params.template.params.join(", ")}]`
        : media.length
          ? `${media.length} media + "${params.body}"`
          : params.body;
      this.logger.log(`[mock] WhatsApp → ${params.to}: ${what}`);
      return { ok: true, channelMsgId: `wamid.mock_${Date.now()}`, simulated: true };
    }
    if (params.template) return this.sendTemplateMessage(creds, params.to, params.template);
    return media.length ? this.sendWithMedia(creds, params, media) : this.sendTextOnly(creds, params);
  }

  /** Send an approved template (type:template) with its body variables filled. */
  private async sendTemplateMessage(
    creds: WhatsAppCreds,
    to: string,
    tpl: OutboundTemplate,
  ): Promise<SendResult> {
    const components = tpl.params.length
      ? [{ type: "body", parameters: tpl.params.map((text) => ({ type: "text", text })) }]
      : [];
    return this.postMessage(creds, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: tpl.name, language: { code: tpl.language }, components },
    });
  }

  private async sendTextOnly(creds: WhatsAppCreds, params: SendParams): Promise<SendResult> {
    return this.postMessage(creds, {
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      // Quote the message being replied to, so it renders as a WhatsApp reply.
      ...(params.replyToChannelMsgId ? { context: { message_id: params.replyToChannelMsgId } } : {}),
      text: { body: params.body },
    });
  }

  private async sendWithMedia(
    creds: WhatsAppCreds,
    params: SendParams,
    media: OutboundMedia[],
  ): Promise<SendResult> {
    let firstId: string | undefined;
    let firstError: string | undefined;
    let captionUsed = false;

    for (const item of media) {
      const mediaId = await this.uploadMedia(creds, item);
      if (!mediaId) {
        firstError ??= `upload failed for ${item.filename}`;
        continue;
      }
      const type = waMediaType(item.kind);
      const obj: Record<string, unknown> = { id: mediaId };
      // Ride the text body on the first captionable media, once.
      if (!captionUsed && params.body && captionable(type)) {
        obj.caption = params.body;
        captionUsed = true;
      }
      if (type === "document") obj.filename = item.filename;
      const res = await this.postMessage(creds, {
        messaging_product: "whatsapp",
        to: params.to,
        type,
        [type]: obj,
      });
      if (res.ok) firstId ??= res.channelMsgId;
      else firstError ??= res.error;
    }

    // If the caption never landed (e.g. only a voice note), send the text separately.
    if (params.body && !captionUsed) {
      const res = await this.sendTextOnly(creds, params);
      if (res.ok) firstId ??= res.channelMsgId;
      else firstError ??= res.error;
    }

    if (firstId) return { ok: true, channelMsgId: firstId, simulated: false };
    return { ok: false, error: firstError ?? "media send failed" };
  }

  /** POST a message payload to the Graph messages endpoint. */
  private async postMessage(creds: WhatsAppCreds, payload: Record<string, unknown>): Promise<SendResult> {
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        messages?: Array<{ id: string }>;
        error?: { code?: number; message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          error: JSON.stringify(json.error ?? json),
          errorCode: json.error?.code != null ? String(json.error.code) : undefined,
          httpStatus: res.status,
        };
      }
      // Real WhatsApp reports delivered/read via status webhooks, so don't fake it.
      return { ok: true, channelMsgId: json.messages?.[0]?.id, simulated: false };
    } catch (err) {
      // Network/transport error before any HTTP response — transient, worth a retry.
      return { ok: false, error: String(err), retryable: true };
    }
  }

  /** Upload media bytes to Graph, returning the resulting media id (or null). */
  private async uploadMedia(creds: WhatsAppCreds, item: OutboundMedia): Promise<string | null> {
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/media`;
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", item.mime);
      form.append("file", new Blob([item.bytes], { type: item.mime }), item.filename);
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}` },
        body: form,
      });
      const json = (await res.json()) as { id?: string; error?: unknown };
      if (!res.ok || !json.id) {
        this.logger.warn(`WhatsApp media upload failed: ${JSON.stringify(json.error ?? json)}`);
        return null;
      }
      return json.id;
    } catch (err) {
      this.logger.warn(`WhatsApp media upload error: ${String(err)}`);
      return null;
    }
  }

  /** The number's own credentials (Meta-connected inbox) or the global env ones. */
  private async credsFor(inboxId: string): Promise<WhatsAppCreds | null> {
    const config = await this.store.getInboxConfig(inboxId);
    if (config?.phoneNumberId && config?.accessToken) {
      return { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken };
    }
    if (env.whatsapp.phoneNumberId && env.whatsapp.token) {
      return { phoneNumberId: env.whatsapp.phoneNumberId, accessToken: env.whatsapp.token };
    }
    return null;
  }
}
