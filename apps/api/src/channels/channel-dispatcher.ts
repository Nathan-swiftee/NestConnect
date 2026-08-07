import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConversationWithMessages, Message, MessageStatus } from "@ding/schemas";
import { Store } from "../data/store";
import { MediaService } from "../storage/media.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  CHANNEL_PROVIDERS,
  ChannelProvider,
  type OutboundMedia,
  type OutboundTemplate,
  type SendContext,
} from "./channel-provider";

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
    private readonly media: MediaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async dispatchOutbound(
    conversation: ConversationWithMessages,
    message: Message,
    template?: OutboundTemplate,
    opts?: { cc?: string[]; bcc?: string[] },
  ): Promise<void> {
    // Email is served by more than one provider (Gmail vs generic), chosen by
    // the inbox's connected provider. Other channels ignore the context.
    const ctx =
      conversation.channel === "email"
        ? { provider: (await this.store.getInboxConfig(conversation.inboxId))?.provider }
        : undefined;
    const provider = this.providers.find((p) => p.supports(conversation.channel, ctx));
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

    const media = template ? undefined : await this.resolveMedia(message);
    // If this reply quotes an earlier message, pass its provider id so the
    // channel threads it as a reply.
    const replyToChannelMsgId = message.quotedMsgId
      ? conversation.messages.find((m) => m.id === message.quotedMsgId)?.channelMsgId ?? undefined
      : undefined;
    const result = await provider.sendText({
      to,
      body: message.body,
      bodyHtml: message.bodyHtml ?? undefined,
      cc: opts?.cc,
      bcc: opts?.bcc,
      conversation,
      context,
      media,
      template,
      replyToChannelMsgId,
    });
    if (result.channelMsgId) {
      await this.store.setMessageChannelId(message.id, result.channelMsgId);
    }
    if (!result.ok) {
      this.logger.warn(`Send failed on ${conversation.channel}: ${result.error}`);
      await this.transition(result.channelMsgId, "failed", 0);
      return;
    }
    // The provider accepted it → "sent" (single grey tick). Real channels then
    // move delivered/read via status webhooks; the mock fakes that ladder.
    void this.transition(result.channelMsgId, "sent", 0);
    if (result.simulated && result.channelMsgId) {
      void this.transition(result.channelMsgId, "delivered", 1400);
      void this.transition(result.channelMsgId, "read", 3200);
    }
  }

  /** Send a read receipt for an inbound message on a channel that supports it. */
  async markRead(conversation: ConversationWithMessages, channelMsgId: string): Promise<void> {
    const provider = this.providers.find((p) => p.supports(conversation.channel) && p.markRead);
    if (!provider?.markRead) return;
    try {
      await provider.markRead({ conversation, channelMsgId });
    } catch (err) {
      this.logger.warn(`markRead failed on ${conversation.channel}: ${String(err)}`);
    }
  }

  /** Show the customer a typing indicator on a channel that supports it. */
  async sendTyping(conversation: ConversationWithMessages, channelMsgId: string): Promise<void> {
    const provider = this.providers.find((p) => p.supports(conversation.channel) && p.sendTyping);
    if (!provider?.sendTyping) return;
    try {
      await provider.sendTyping({ conversation, channelMsgId });
    } catch (err) {
      this.logger.warn(`sendTyping failed on ${conversation.channel}: ${String(err)}`);
    }
  }

  /** Deliver an emoji reaction to a message on a channel that supports it. */
  async sendReaction(
    conversation: ConversationWithMessages,
    channelMsgId: string,
    emoji: string,
  ): Promise<void> {
    const provider = this.providers.find((p) => p.supports(conversation.channel) && p.sendReaction);
    if (!provider?.sendReaction) return;
    try {
      await provider.sendReaction({ conversation, channelMsgId, emoji });
    } catch (err) {
      this.logger.warn(`sendReaction failed on ${conversation.channel}: ${String(err)}`);
    }
  }

  /** Turn a message's attachments into ready-to-send media (bytes loaded from storage). */
  private async resolveMedia(message: Message): Promise<OutboundMedia[] | undefined> {
    if (!message.attachments?.length) return undefined;
    const out: OutboundMedia[] = [];
    for (const att of message.attachments) {
      const loaded = await this.media.load(att.id);
      if (!loaded) {
        this.logger.warn(`Outbound attachment ${att.id} could not be loaded — skipping`);
        continue;
      }
      out.push({
        kind: att.kind,
        mime: att.mime,
        filename: att.filename,
        bytes: loaded.bytes,
        durationMs: att.durationMs,
      });
    }
    return out.length ? out : undefined;
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
