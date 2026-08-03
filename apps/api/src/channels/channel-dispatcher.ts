import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConversationWithMessages, Message, MessageStatus } from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CHANNEL_PROVIDERS, ChannelProvider, type SendContext } from "./channel-provider";

/**
 * Sends outbound messages through the right channel provider and reconciles
 * delivery status back onto the message (moving the ticks). Channel-agnostic:
 * it picks the recipient address and threading context by channel.
 */
@Injectable()
export class ChannelDispatcher {
  private readonly logger = new Logger(ChannelDispatcher.name);

  constructor(
    @Inject(CHANNEL_PROVIDERS) private readonly providers: ChannelProvider[],
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
  ) {}

  async dispatchOutbound(conversation: ConversationWithMessages, message: Message): Promise<void> {
    const provider = this.providers.find((p) => p.supports(conversation.channel));
    if (!provider) return; // channel not wired for sending yet

    const to = conversation.channel === "email" ? conversation.contact.email : conversation.contact.phone;
    if (!to) {
      this.logger.warn(`Conversation ${conversation.id} has no ${conversation.channel} address to send to`);
      return;
    }

    let context: SendContext | undefined;
    if (conversation.channel === "email") {
      const prior = [...conversation.messages]
        .reverse()
        .find((m) => m.channelMsgId && m.id !== message.id);
      context = {
        subject: conversation.subject ?? undefined,
        toName: conversation.contact.displayName,
        inReplyTo: prior?.channelMsgId ?? undefined,
      };
    }

    const result = await provider.sendText({ to, body: message.body, conversation, context });
    if (result.channelMsgId) {
      await this.store.setMessageChannelId(message.id, result.channelMsgId);
    }
    if (!result.ok) {
      this.logger.warn(`Send failed on ${conversation.channel}: ${result.error}`);
      await this.transition(result.channelMsgId, "failed", 0);
      return;
    }
    if (provider.simulatesStatus && result.channelMsgId) {
      void this.transition(result.channelMsgId, "delivered", 1200);
      void this.transition(result.channelMsgId, "read", 2600);
    }
  }

  private transition(channelMsgId: string | undefined, status: MessageStatus, delay: number): Promise<void> {
    if (!channelMsgId) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(async () => {
        const updated = await this.store.updateMessageStatusByChannelId(channelMsgId, status);
        if (updated) this.realtime.emitMessageUpdated(updated.conversationId, updated.message);
        resolve();
      }, delay);
    });
  }
}
