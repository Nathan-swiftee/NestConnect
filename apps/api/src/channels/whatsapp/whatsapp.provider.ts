import { Injectable, Logger } from "@nestjs/common";
import type { AttachmentKind, ChannelType } from "@ding/schemas";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import {
  ChannelProvider,
  type OutboundMedia,
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

  async sendText(params: SendParams): Promise<SendResult> {
    const creds = await this.credsFor(params.conversation.inboxId);
    const media = params.media ?? [];
    if (!creds) {
      const what = media.length ? `${media.length} media + "${params.body}"` : params.body;
      this.logger.log(`[mock] WhatsApp → ${params.to}: ${what}`);
      return { ok: true, channelMsgId: `wamid.mock_${Date.now()}`, simulated: true };
    }
    return media.length ? this.sendWithMedia(creds, params, media) : this.sendTextOnly(creds, params);
  }

  private async sendTextOnly(creds: WhatsAppCreds, params: SendParams): Promise<SendResult> {
    return this.postMessage(creds, {
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
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
      const json = (await res.json()) as { messages?: Array<{ id: string }>; error?: unknown };
      if (!res.ok) return { ok: false, error: JSON.stringify(json.error ?? json) };
      // Real WhatsApp reports delivered/read via status webhooks, so don't fake it.
      return { ok: true, channelMsgId: json.messages?.[0]?.id, simulated: false };
    } catch (err) {
      return { ok: false, error: String(err) };
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
