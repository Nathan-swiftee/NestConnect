import { Injectable, Logger } from "@nestjs/common";
import type { ChannelType } from "@ding/schemas";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import { ChannelProvider, type SendParams, type SendResult } from "../channel-provider";

interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * WhatsApp Business Platform (Cloud API) sender. Credentials are resolved per
 * inbox — a number connected via Meta carries its own token/phone-number-id in
 * channelConfig — falling back to the global env credentials. With neither, the
 * send is mocked so the whole path is exercisable in dev/CI without a live number.
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
    if (!creds) {
      this.logger.log(`[mock] WhatsApp → ${params.to}: ${params.body}`);
      return { ok: true, channelMsgId: `wamid.mock_${Date.now()}`, simulated: true };
    }
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: params.to,
          type: "text",
          text: { body: params.body },
        }),
      });
      const json = (await res.json()) as { messages?: Array<{ id: string }>; error?: unknown };
      if (!res.ok) return { ok: false, error: JSON.stringify(json.error ?? json) };
      // Real WhatsApp reports delivered/read via status webhooks, so don't fake it.
      return { ok: true, channelMsgId: json.messages?.[0]?.id, simulated: false };
    } catch (err) {
      return { ok: false, error: String(err) };
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
