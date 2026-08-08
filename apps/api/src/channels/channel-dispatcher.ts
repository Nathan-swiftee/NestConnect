import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConversationWithMessages, Message } from "@ding/schemas";
import { Store } from "../data/store";
import { MediaService } from "../storage/media.service";
import { redactSecrets } from "../crypto/redact";
import {
  CHANNEL_PROVIDERS,
  ChannelProvider,
  isRetryableStatus,
  type OutboundMedia,
  type OutboundTemplate,
  type SendContext,
} from "./channel-provider";

/**
 * The result of a single provider send attempt, in the domain's terms. The
 * delivery layer (queue/worker) turns this into status writes + retries; the
 * dispatcher itself performs no persistence and schedules no timers.
 */
export type DeliveryOutcome =
  | { ok: true; channelMsgId?: string; simulated: boolean }
  | { ok: false; retryable: boolean; reason: string; error?: string; code?: string };

/**
 * Sends an outbound message through the right channel provider and reports the
 * outcome. Channel-agnostic: it picks the recipient address and threading
 * context by channel, then calls the provider. It is deliberately side-effect
 * free with respect to message state so it can be driven by a durable job queue.
 */
@Injectable()
export class ChannelDispatcher {
  private readonly logger = new Logger(ChannelDispatcher.name);

  constructor(
    @Inject(CHANNEL_PROVIDERS) private readonly providers: ChannelProvider[],
    private readonly store: Store,
    private readonly media: MediaService,
  ) {}

  /** Attempt one send. Returns a structured outcome; never throws for a normal
   *  provider rejection (only genuinely unexpected errors propagate). */
  async attemptSend(
    conversation: ConversationWithMessages,
    message: Message,
    template?: OutboundTemplate,
    opts?: { cc?: string[]; bcc?: string[] },
  ): Promise<DeliveryOutcome> {
    // Email is served by more than one provider (Gmail vs generic), chosen by
    // the inbox's connected provider. Other channels ignore the context.
    const ctx =
      conversation.channel === "email"
        ? { provider: (await this.store.getInboxConfig(conversation.inboxId))?.provider }
        : undefined;
    const provider = this.providers.find((p) => p.supports(conversation.channel, ctx));
    if (!provider) {
      // Channel not wired for sending — a configuration error, not worth retrying.
      return { ok: false, retryable: false, reason: `No provider configured for ${conversation.channel}` };
    }

    const to = conversation.channel === "email" ? conversation.contact.email : conversation.contact.phone;
    if (!to) {
      return { ok: false, retryable: false, reason: `Conversation has no ${conversation.channel} address` };
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

    if (result.ok) {
      return { ok: true, channelMsgId: result.channelMsgId, simulated: Boolean(result.simulated) };
    }
    const retryable = result.retryable ?? isRetryableStatus(result.httpStatus);
    this.logger.warn(
      `Send failed on ${conversation.channel} (${retryable ? "transient" : "permanent"}): ${redactSecrets(result.error)}`,
    );
    return {
      ok: false,
      retryable,
      reason: shortReason(conversation.channel, result),
      error: result.error,
      code: result.errorCode,
    };
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
}

/** A short, user-facing failure reason derived from a provider send result. */
function shortReason(channel: string, result: { httpStatus?: number; errorCode?: string }): string {
  const label = channel === "email" ? "Email" : "WhatsApp";
  if (result.httpStatus === 401 || result.httpStatus === 403) return `${label}: authentication rejected`;
  if (result.httpStatus === 429) return `${label}: rate limited`;
  if (result.httpStatus && result.httpStatus >= 500) return `${label}: provider error (${result.httpStatus})`;
  if (result.httpStatus && result.httpStatus >= 400) return `${label}: rejected (${result.httpStatus})`;
  return `${label}: delivery failed`;
}
