import { Injectable } from "@nestjs/common";
import type {
  ChannelType,
  Conversation,
  ConversationWithMessages,
  NestChatMessage,
} from "@ding/schemas";
import {
  ChannelProvider,
  type SendParams,
  type SendResult,
} from "../channel-provider";
import { CustomerPushService } from "./customer-push.service";
import { VisitorBus } from "./visitor-bus";
import { toVisitorMessage } from "./visitor-message";

/**
 * NestChat outbound: an agent's reply on our own live chat.
 *
 * Every other provider hands a message to somebody else's API and waits to hear
 * whether it was accepted. This one has no third party: the message is already
 * persisted by the time the dispatcher calls us, and the visitor's widget reads
 * it from our own database. All that is left is to nudge the open widget so the
 * reply appears without waiting for the next fetch.
 *
 * So a NestChat send cannot fail in the way a WhatsApp send can, and it must
 * never be marked "simulated" either — that flag is for a send with no live
 * credentials, which fakes delivery ticks. This delivery is real; it just has a
 * very short wire.
 */
@Injectable()
export class NestChatProvider extends ChannelProvider {
  constructor(
    private readonly bus: VisitorBus,
    private readonly push: CustomerPushService,
  ) {
    super();
  }

  supports(channel: ChannelType): boolean {
    return channel === "nestchat";
  }

  async sendText(params: SendParams): Promise<SendResult> {
    const conversationId = params.conversation.id;
    // The widget renders from the stored message, which the caller has already
    // written — so this only wakes an open stream. A visitor who closed the tab
    // simply reads it when they come back. The id is the stored message's, so a
    // widget that also refetches recognises the two as one message.
    this.bus.publish(conversationId, { kind: "message", payload: this.visitorPayload(params) });
    // …and ring their phone, unless they are already looking at it. Here
    // rather than in the dispatcher because this is the one channel whose
    // recipient is a customer of somebody else's app: every other channel's
    // notification is the phone network's or Google's problem, not ours.
    this.push.notify({
      conversation: params.conversation,
      authorName: params.authorName,
      body: params.body,
      attachmentCount: params.media?.length ?? 0,
    });

    // A NestChat message has no provider id — there is no provider. Returning
    // none leaves the stored message's channelMsgId null, which is correct and
    // keeps it out of the email/WhatsApp threading lookups that match on one.
    return { ok: true };
  }

  /**
   * The reply, shaped the way the widget reads every other message.
   *
   * Preferring the stored row matters for one field in particular: a reply
   * that quotes the visitor knows what it quotes only from the database.
   * Rebuilding the payload from the send parameters alone loses the quote —
   * the agent's reply arrives in the widget as a bare sentence answering
   * nothing, which is exactly the case swipe-to-reply exists for.
   *
   * The fallback is for the window where the conversation we were handed was
   * read before this message was appended to it. Everything the parameters
   * carry is still true; only the quote is missing, and a reply without its
   * quote beats no reply at all.
   */
  private visitorPayload(params: SendParams): NestChatMessage {
    const thread = (params.conversation as ConversationWithMessages).messages;
    const stored = params.messageId ? thread?.find((m) => m.id === params.messageId) : undefined;
    const mapped = stored ? toVisitorMessage(stored, thread) : undefined;
    if (mapped) return mapped;

    return {
      id: params.messageId ?? `${params.conversation.id}:${Date.now()}`,
      from: "agent",
      authorName: params.authorName,
      body: params.body,
      at: new Date().toISOString(),
      attachments: params.media?.length
        ? params.media.map((m) => ({ id: m.id, filename: m.filename, mime: m.mime }))
        : undefined,
      // Never absent, even though a message this new cannot have any. A key
      // that appears only once somebody reacts is a key every reader has to
      // defend against, and the widget would be reading `undefined.length` on
      // the commonest message there is.
      reactions: [],
    };
  }

  /** Relay the agent's typing to the visitor's widget. Unlike WhatsApp this is
   *  ours end to end, so there is no 25-second cap and no message to tie it to. */
  async sendTyping(params: { conversation: { id: string } }): Promise<void> {
    this.bus.publish(params.conversation.id, { kind: "typing", who: "agent", typing: true });
  }

  /**
   * Somebody at the business has read the visitor's messages — show them so.
   *
   * A fact about the conversation rather than about one message: an agent
   * opening a thread has read what's in it, which is exactly what the widget
   * puts a "Seen" under.
   */
  async markRead(params: { conversation: { id: string } }): Promise<void> {
    this.bus.publish(params.conversation.id, { kind: "read", at: new Date().toISOString() });
  }

  /**
   * An agent put an emoji on a message — show it in the visitor's widget.
   *
   * Every other channel's reaction is a request to somebody else's API keyed
   * on their id for the message. Ours has no third party and no such id, so
   * the dispatcher hands over our own `messageId` and this finds the message
   * in the conversation it was given.
   *
   * The whole message goes over the wire, not the one emoji: reactions are a
   * set with one slot per person, and a client applying a delta has to know
   * what was already there to know whether this replaces it — which is
   * exactly what the two sides disagree about during two taps in quick
   * succession.
   */
  async sendReaction(params: {
    conversation: Conversation;
    channelMsgId: string;
    messageId?: string;
    emoji: string;
  }): Promise<void> {
    const id = params.messageId ?? params.channelMsgId;
    const thread = (params.conversation as ConversationWithMessages).messages;
    const updated = thread?.find((m) => m.id === id);
    if (!updated) return;
    const visible = toVisitorMessage(updated, thread);
    // Nothing back for an internal note: the mapping refuses it, and a
    // reaction on one is not the visitor's business either.
    if (visible) this.bus.publish(params.conversation.id, { kind: "reaction", payload: visible });
  }
}
