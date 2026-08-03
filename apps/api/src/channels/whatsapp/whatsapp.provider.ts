import { Injectable, Logger } from "@nestjs/common";
import type { ChannelType, Conversation } from "@ding/schemas";
import { env } from "../../config/env";
import { ChannelProvider, type SendResult } from "../channel-provider";

/**
 * WhatsApp Business Platform (Cloud API) sender. Runs in mock mode until Meta
 * credentials are configured — so the whole send path is exercisable in dev/CI
 * without a live WhatsApp number.
 */
@Injectable()
export class WhatsAppCloudProvider extends ChannelProvider {
  private readonly logger = new Logger(WhatsAppCloudProvider.name);

  private get isLive(): boolean {
    return Boolean(env.whatsapp.token && env.whatsapp.phoneNumberId);
  }

  get simulatesStatus(): boolean {
    return !this.isLive;
  }

  supports(channel: ChannelType): boolean {
    return channel === "whatsapp" || channel === "whatsapp_group";
  }

  async sendText(params: { to: string; body: string; conversation: Conversation }): Promise<SendResult> {
    if (!this.isLive) {
      this.logger.log(`[mock] WhatsApp → ${params.to}: ${params.body}`);
      return { ok: true, channelMsgId: `wamid.mock_${Date.now()}_${Math.floor(Math.random() * 1e6)}` };
    }
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${env.whatsapp.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: params.to,
          type: "text",
          text: { body: params.body },
        }),
      });
      const json = (await res.json()) as { messages?: Array<{ id: string }>; error?: unknown };
      if (!res.ok) return { ok: false, error: JSON.stringify(json.error ?? json) };
      return { ok: true, channelMsgId: json.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
