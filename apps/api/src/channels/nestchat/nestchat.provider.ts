import { Injectable } from "@nestjs/common";
import type { ChannelType } from "@ding/schemas";
import {
  ChannelProvider,
  type SendParams,
  type SendResult,
} from "../channel-provider";
import { VisitorBus } from "./visitor-bus";

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
  constructor(private readonly bus: VisitorBus) {
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
    this.bus.publish(conversationId, {
      kind: "message",
      payload: {
        id: params.messageId ?? `${conversationId}:${Date.now()}`,
        from: "agent" as const,
        authorName: params.authorName,
        body: params.body,
        at: new Date().toISOString(),
        attachments: params.media?.length
          ? params.media.map((m) => ({ id: m.id, filename: m.filename, mime: m.mime }))
          : undefined,
      },
    });
    // A NestChat message has no provider id — there is no provider. Returning
    // none leaves the stored message's channelMsgId null, which is correct and
    // keeps it out of the email/WhatsApp threading lookups that match on one.
    return { ok: true };
  }

  /** Relay the agent's typing to the visitor's widget. Unlike WhatsApp this is
   *  ours end to end, so there is no 25-second cap and no message to tie it to. */
  async sendTyping(params: { conversation: { id: string }; channelMsgId: string }): Promise<void> {
    this.bus.publish(params.conversation.id, { kind: "typing", who: "agent", typing: true });
  }
}
