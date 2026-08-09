import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AssignConversationInput,
  Conversation,
  ConversationPage,
  ConversationWithMessages,
  Message,
  MessagePage,
  SendMessageInput,
  UpdatePriorityInput,
  UpdateStatusInput,
} from "@ding/schemas";
import { Store, type OutboundDeliveryMeta } from "../data/store";
import { isWaChannel } from "../data/mappers";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ChannelDispatcher } from "../channels/channel-dispatcher";
import type { OutboundTemplate } from "../channels/channel-provider";
import { OutboundQueue } from "../queue/outbound-queue";
import { sanitizeOutboundHtml, htmlToText } from "../channels/email/html-sanitize";

/** WhatsApp's 24-hour customer-service window: open while the last WhatsApp
 *  inbound in the thread is under 24h old. Computed from the messages (with a
 *  fallback to the conversation's channel for legacy rows) so a cross-channel
 *  thread — which may be email-primary — is handled correctly. */
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;
function waWindowOpenFromMessages(messages: Message[], convChannel: string): boolean {
  const lastWaInbound = [...messages]
    .reverse()
    .find((m) => m.direction === "in" && isWaChannel(m.channel ?? convChannel));
  return lastWaInbound ? Date.now() - new Date(lastWaInbound.createdAt).getTime() < WA_WINDOW_MS : false;
}

/** Fill a template body's {{1}}, {{2}} … positional variables from `params`. */
function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/** Assemble the persisted send hints, omitting empty parts (undefined when none). */
function buildDeliveryMeta(
  template?: OutboundTemplate,
  subject?: string,
  cc?: string[],
  bcc?: string[],
  signatureHtml?: string,
): OutboundDeliveryMeta | undefined {
  const meta: OutboundDeliveryMeta = {};
  if (template) meta.template = template;
  if (subject) meta.subject = subject;
  if (cc?.length) meta.cc = cc;
  if (bcc?.length) meta.bcc = bcc;
  if (signatureHtml) meta.signatureHtml = signatureHtml;
  return Object.keys(meta).length ? meta : undefined;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
    private readonly dispatcher: ChannelDispatcher,
    private readonly queue: OutboundQueue,
  ) {}

  list(view: string, userId: string, opts?: { cursor?: string; limit?: number }): Promise<ConversationPage> {
    return this.store.listConversations(view, userId, opts);
  }

  /** Global search across all conversations (contact, subject, preview, body). */
  search(query: string, opts?: { cursor?: string; limit?: number }): Promise<ConversationPage> {
    return this.store.searchConversations(query, opts);
  }

  /** Older messages in a thread (scroll-up history), before a seq cursor. */
  messages(conversationId: string, opts?: { before?: string; limit?: number }): Promise<MessagePage> {
    return this.store.listMessages(conversationId, opts);
  }

  async get(id: string): Promise<ConversationWithMessages> {
    const conv = await this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async sendMessage(id: string, input: SendMessageInput, userId: string): Promise<Message> {
    const author = await this.store.getUser(userId);
    if (!author) throw new NotFoundException("Current user not found");

    const conv = await this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);

    // Cross-channel reply: the agent may answer on any channel the customer is
    // reachable on, within this one open thread. The effective channel defaults
    // to the conversation's own; an explicit override must have an address on file.
    const channelOverride = input.channel && input.channel !== conv.channel ? input.channel : undefined;
    const effectiveChannel = channelOverride ?? conv.channel;
    const sendingEmail = effectiveChannel === "email";
    const sendingWa = isWaChannel(effectiveChannel);
    if (!input.internal && channelOverride) {
      if (sendingEmail && !conv.contact.email) {
        throw new BadRequestException("This customer has no email address on file.");
      }
      if (sendingWa && !conv.contact.phone) {
        throw new BadRequestException("This customer has no WhatsApp number on file.");
      }
    }

    // A template send: resolve it and render the body from its variables.
    let template: OutboundTemplate | undefined;
    let body = input.body;
    if (input.template) {
      const tpl = await this.store.getTemplate(input.template.id);
      if (!tpl) throw new NotFoundException("Template not found");
      body = fillTemplate(tpl.body, input.template.params);
      template = { name: tpl.name, language: tpl.language, params: input.template.params };
    }

    // A rich email reply carries HTML from the composer — sanitize it (keeps the
    // agent's own images/links, strips scripts) before it's stored or sent, and
    // derive the plain-text body from it when the composer only produced HTML.
    let bodyHtml: string | undefined;
    if (input.bodyHtml && !input.internal && !template && sendingEmail) {
      bodyHtml = sanitizeOutboundHtml(input.bodyHtml) || undefined;
      if (bodyHtml && !body.trim()) body = htmlToText(bodyHtml);
    }

    // Enforce WhatsApp's 24-hour window when replying on WhatsApp. For a
    // WhatsApp-primary thread use its computed window (unchanged behaviour); for
    // a cross-channel thread compute it from the last WhatsApp inbound message.
    if (!input.internal && !template && sendingWa) {
      const open = isWaChannel(conv.channel)
        ? (conv.waWindow?.open ?? false)
        : waWindowOpenFromMessages(conv.messages, conv.channel);
      if (!open) {
        throw new BadRequestException(
          "This WhatsApp conversation's 24-hour window has closed — send an approved template to reply.",
        );
      }
    }

    // An edited subject (email only) becomes the thread's subject before we
    // enqueue, so the delivery — which reloads the conversation by id — sends
    // with it and the header/list reflect it immediately.
    if (sendingEmail && !input.internal && input.subject !== undefined) {
      const next = input.subject.trim();
      if ((next || null) !== (conv.subject ?? null)) {
        const updated = await this.store.setSubject(id, next || null);
        if (updated) {
          conv.subject = updated.subject;
          this.realtime.emitConversationUpdated(updated);
        }
      }
    }

    // Build the channel-specific send hints, persisted with the message so a
    // (re)delivery can be reconstructed from the DB alone after a restart.
    const cc = input.internal ? undefined : input.cc?.filter((a) => a.trim());
    const bcc = input.internal ? undefined : input.bcc?.filter((a) => a.trim());
    // Record the subject on email sends so the message can show it (the thread's
    // subject was just updated above from any edit).
    const emailSubject = !input.internal && sendingEmail ? conv.subject ?? undefined : undefined;
    // Snapshot the sender's signature so the outbound email carries it — appended
    // to the wire body only, never stored on the shown message.
    const signatureHtml =
      !input.internal && sendingEmail ? author.emailSignature?.trim() || undefined : undefined;
    const deliveryMeta: OutboundDeliveryMeta | undefined = input.internal
      ? undefined
      : buildDeliveryMeta(template, emailSubject, cc, bcc, signatureHtml);
    // Idempotency key doubles as the delivery job id, so duplicate sends collapse.
    const idempotencyKey = input.internal ? undefined : randomUUID();

    const message = await this.store.addMessage(
      id,
      {
        body,
        bodyHtml,
        internal: input.internal,
        attachmentIds: input.attachmentIds,
        quotedMsgId: input.quotedMsgId,
        channel: channelOverride,
        idempotencyKey,
        deliveryMeta,
      },
      author,
    );
    if (!message) throw new NotFoundException(`Conversation ${id} not found`);

    // Broadcast immediately so every open client updates the thread + previews.
    this.realtime.emitMessageCreated(id, message, conv.orgId);

    // Real (non-internal) replies are enqueued for durable delivery. The message
    // is already persisted (status "queued"); the queue drives it to sent/failed
    // with retries, so a crash here never loses it — the recovery sweep re-drives
    // any message left queued/sending.
    if (!input.internal) {
      // An agent reply meets the first-response SLA — stop the clock.
      const cleared = await this.store.setSla(id, null);
      if (cleared) this.realtime.emitConversationUpdated(cleared);
      await this.queue.enqueueDelivery({ messageId: message.id, conversationId: id }, idempotencyKey);
    }
    return message;
  }

  /** Manually retry a failed outbound message: reset it to queued and re-enqueue. */
  async retryMessage(messageId: string): Promise<Message> {
    const key = randomUUID();
    const change = await this.store.resetMessageForRetry(messageId, key);
    if (!change) throw new BadRequestException("Message is not in a retryable state");
    this.realtime.emitMessageUpdated(change.conversationId, change.message);
    await this.queue.enqueueDelivery(
      { messageId, conversationId: change.conversationId },
      key,
    );
    return change.message;
  }

  async assign(id: string, input: AssignConversationInput, byUserId: string): Promise<Conversation> {
    const conv = await this.store.assign(id, input, byUserId);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    const by = (await this.store.getUser(byUserId))?.name;
    this.realtime.emitConversationAssigned(conv, by);
    return conv;
  }

  async setStatus(id: string, input: UpdateStatusInput): Promise<Conversation> {
    const conv = await this.store.setStatus(id, input.status);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    // Broadcast so every client drops (or restores) it from the active lists live.
    this.realtime.emitConversationUpdated(conv);
    return conv;
  }

  async setPriority(id: string, input: UpdatePriorityInput): Promise<Conversation> {
    const conv = await this.store.setPriority(id, input.priority);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    this.realtime.emitConversationUpdated(conv);
    return conv;
  }

  async snooze(id: string, until: string): Promise<Conversation> {
    const conv = await this.store.snooze(id, until);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    // Drops it from the active lists and into "Later" on every client live.
    this.realtime.emitConversationUpdated(conv);
    return conv;
  }

  /** Agent opened/read a conversation: clear its unread badge and, on WhatsApp,
   *  send the customer a read receipt (blue ticks) for their latest message. */
  async markRead(id: string): Promise<Conversation> {
    const conv = await this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    const updated = await this.store.clearUnread(id);
    if (updated) this.realtime.emitConversationUpdated(updated);
    if (conv.channel === "whatsapp" || conv.channel === "whatsapp_group") {
      const lastInbound = [...conv.messages]
        .reverse()
        .find((m) => m.direction === "in" && m.channelMsgId);
      if (lastInbound?.channelMsgId) void this.dispatcher.markRead(conv, lastInbound.channelMsgId);
    }
    return updated ?? conv;
  }

  /** An agent reacts to a message with an emoji (empty removes theirs). Stores
   *  it, broadcasts the update, and delivers it to the customer on WhatsApp. */
  async react(conversationId: string, messageId: string, emoji: string): Promise<Message> {
    const updated = await this.store.reactToMessage(messageId, emoji, "user");
    if (!updated) throw new NotFoundException("Message not found");
    this.realtime.emitMessageUpdated(updated.conversationId, updated.message);
    if (updated.message.channelMsgId) {
      const conv = await this.store.getConversation(conversationId);
      if (conv && (conv.channel === "whatsapp" || conv.channel === "whatsapp_group")) {
        void this.dispatcher.sendReaction(conv, updated.message.channelMsgId, emoji);
      }
    }
    return updated.message;
  }

  /** Agent is typing: show the customer a "typing…" indicator on WhatsApp.
   *  Only works within the 24-hour window (it rides on the customer's last
   *  inbound message) — a no-op otherwise. */
  async sendTyping(id: string): Promise<void> {
    const conv = await this.store.getConversation(id);
    if (!conv) return;
    if (conv.channel !== "whatsapp" && conv.channel !== "whatsapp_group") return;
    if (conv.waWindow && !conv.waWindow.open) return;
    const lastInbound = [...conv.messages]
      .reverse()
      .find((m) => m.direction === "in" && m.channelMsgId);
    if (lastInbound?.channelMsgId) await this.dispatcher.sendTyping(conv, lastInbound.channelMsgId);
  }
}
