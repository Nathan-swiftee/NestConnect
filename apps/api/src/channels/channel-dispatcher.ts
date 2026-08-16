import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ChannelType, ConversationWithMessages, Message } from "@ding/schemas";
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
import { forwardSubject } from "./email/email.provider";

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
    opts?: { cc?: string[]; bcc?: string[]; signatureHtml?: string; forwardTo?: string[] },
  ): Promise<DeliveryOutcome> {
    // A message may be sent on a different channel than the conversation's own
    // (cross-channel reply within one open thread). Resolve the effective channel
    // and the inbox to send from. The conversation's inbox tracks the customer's
    // most-recent channel, which can differ from the origin `channel`, so compare
    // the target channel against the inbox's *type* (whatsapp_group ≡ whatsapp):
    // send from that inbox when it serves the channel, else the channel's primary
    // inbox. For a conversation that never went cross-channel this is unchanged.
    const channel = message.channel ?? conversation.channel;
    const waNorm = (t: ChannelType): ChannelType => (t === "whatsapp_group" ? "whatsapp" : t);
    const convInbox = await this.store.getInbox(conversation.inboxId);
    const sendingInboxId =
      convInbox && waNorm(convInbox.type) === waNorm(channel)
        ? conversation.inboxId
        : (await this.firstInboxOfType(channel)) ?? conversation.inboxId;

    // Email is served by more than one provider (Gmail vs generic), chosen by
    // the sending inbox's connected provider. Other channels ignore the context.
    const ctx =
      channel === "email"
        ? { provider: (await this.store.getInboxConfig(sendingInboxId))?.provider }
        : undefined;
    const provider = this.providers.find((p) => p.supports(channel, ctx));
    if (!provider) {
      // Channel not wired for sending — a configuration error, not worth retrying.
      return { ok: false, retryable: false, reason: `No provider configured for ${channel}` };
    }

    // A forward (email only) re-addresses this send to other people instead of
    // the customer: the first address is the To, any others ride as Cc, and it
    // goes out as a fresh "Fwd:" thread (built below) rather than a reply.
    const forwardTo = channel === "email" ? opts?.forwardTo?.filter((a) => a.trim()) : undefined;
    const isForward = Boolean(forwardTo?.length);

    // A group message is addressed to the group id (kept on channelRef), not a
    // person's number; a 1:1 message goes to the customer's phone / email.
    const to =
      channel === "email"
        ? isForward
          ? forwardTo![0]
          : conversation.contact.email
        : channel === "whatsapp_group"
          ? conversation.channelRef
          : conversation.contact.phone;
    if (!to) {
      return { ok: false, retryable: false, reason: `Conversation has no ${channel} address` };
    }
    // Extra forward recipients (beyond the To) join any explicit Cc.
    const cc = isForward ? [...forwardTo!.slice(1), ...(opts?.cc ?? [])] : opts?.cc;

    let context: SendContext | undefined;
    if (isForward) {
      // A forward opens a NEW thread to a new recipient — no In-Reply-To /
      // References / Gmail threadId, so it never lands in the customer's thread.
      context = { subject: forwardSubject(conversation.subject), toName: undefined };
    } else if (channel === "email") {
      // Prior EMAIL messages in this thread that carry a Message-ID, oldest→newest
      // (a WhatsApp wamid is not an email Message-ID, so other channels are out).
      const priorEmail = conversation.messages.filter(
        (m) => m.channelMsgId && m.id !== message.id && (m.channel ?? conversation.channel) === "email",
      );
      // The parent is the most-recent one; References chains the whole thread and
      // ends with that parent — this is what the customer's client threads on.
      const chain = priorEmail
        .map((m) => m.channelMsgId)
        .filter((id): id is string => Boolean(id));
      const parentId = chain.length ? chain[chain.length - 1] : undefined;
      context = {
        subject: conversation.subject ?? undefined,
        toName: conversation.contact.displayName,
        inReplyTo: parentId,
        references: chain.length ? chain.join(" ") : undefined,
        // For a Gmail-connected inbox the thread's Gmail id is kept on channelRef;
        // passing it keeps the reply in the same server-side thread. Undefined for
        // Postmark threads, which rely solely on the In-Reply-To/References headers.
        threadId: conversation.channelRef ?? undefined,
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
      cc,
      bcc: opts?.bcc,
      signatureHtml: opts?.signatureHtml,
      conversation,
      inboxId: sendingInboxId,
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
      `Send failed on ${channel} (${retryable ? "transient" : "permanent"}): ${redactSecrets(result.error)}`,
    );
    return {
      ok: false,
      retryable,
      reason: shortReason(channel, result),
      error: result.error,
      code: result.errorCode,
    };
  }

  /** The org's first inbox of a given channel type — the send-from inbox for a
   *  cross-channel reply (its provider creds / from-address are used). */
  private async firstInboxOfType(channel: ChannelType): Promise<string | undefined> {
    const type = channel === "whatsapp_group" ? "whatsapp" : channel;
    const inboxes = await this.store.listInboxes();
    return inboxes.find((i) => i.type === type)?.id;
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
  if (result.errorCode === "not_connected") return `${label} isn’t connected`;
  // Graph error 100 on a send means the phone-number-id and access token don't
  // match (wrong/expired token, or a token for a different number).
  if (result.errorCode === "100") return `${label}: this number’s credentials don’t match — re-check its Phone number ID and access token`;
  if (result.httpStatus === 401 || result.httpStatus === 403) return `${label}: authentication rejected`;
  if (result.httpStatus === 429) return `${label}: rate limited`;
  if (result.httpStatus && result.httpStatus >= 500) return `${label}: provider error (${result.httpStatus})`;
  if (result.httpStatus && result.httpStatus >= 400) return `${label}: rejected (${result.httpStatus})`;
  return `${label}: delivery failed`;
}
