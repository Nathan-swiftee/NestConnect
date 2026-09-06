import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AssignConversationInput,
  Conversation,
  ConversationPage,
  ConversationWithMessages,
  ForwardResult,
  Message,
  MessagePage,
  SendMessageInput,
  UpdatePriorityInput,
  UpdateStatusInput,
} from "@ding/schemas";
import { FORWARD_MAX_TARGETS } from "@ding/schemas";
import { Store, type OutboundDeliveryMeta } from "../data/store";
import { isWaChannel } from "../data/mappers";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ChannelDispatcher } from "../channels/channel-dispatcher";
import type { OutboundTemplate } from "../channels/channel-provider";
import { OutboundQueue } from "../queue/outbound-queue";
import { NotificationsService } from "../notifications/notifications.service";
import { PushService } from "../push/push.service";
import { NestChatService } from "../channels/nestchat/nestchat.service";
import { sanitizeOutboundHtml, htmlToText } from "../channels/email/html-sanitize";
import { forwardSubject } from "../channels/email/email.provider";

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
  forwardTo?: string[],
): OutboundDeliveryMeta | undefined {
  const meta: OutboundDeliveryMeta = {};
  if (template) meta.template = template;
  if (subject) meta.subject = subject;
  if (cc?.length) meta.cc = cc;
  if (bcc?.length) meta.bcc = bcc;
  if (signatureHtml) meta.signatureHtml = signatureHtml;
  if (forwardTo?.length) meta.forwardTo = forwardTo;
  return Object.keys(meta).length ? meta : undefined;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
    private readonly dispatcher: ChannelDispatcher,
    private readonly queue: OutboundQueue,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
    private readonly nestchat: NestChatService,
  ) {}

  list(view: string, userId: string, opts?: { cursor?: string; limit?: number }): Promise<ConversationPage> {
    return this.store.listConversations(view, userId, opts);
  }

  /** Search across conversations (contact, subject, preview, body). Scoped to
   *  one view when the caller names one — the search field lives inside an
   *  inbox, so its results should belong to that inbox. */
  search(
    query: string,
    opts?: { cursor?: string; limit?: number; view?: string; userId?: string },
  ): Promise<ConversationPage> {
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

  /**
   * @param opts.forwarded Mark the send as passing on someone else's message.
   *   Set here rather than on `SendMessageInput` deliberately: "Forwarded" is a
   *   claim about provenance, and a client shouldn't be able to stamp it on
   *   something it wrote itself.
   */
  async sendMessage(
    id: string,
    input: SendMessageInput,
    userId: string,
    opts: { forwarded?: boolean } = {},
  ): Promise<Message> {
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
      // A template belongs to one WhatsApp account, and no other account has
      // ever heard of it. Sending it from the wrong number is accepted here,
      // queued, and rejected by Meta with 132001 "template name does not exist"
      // — a failure that arrives late, out of context, and reads like the
      // template is broken rather than pointed at the wrong number. The pickers
      // filter by account so this should be unreachable from the UI; it is the
      // backstop for an API caller, a stale tab, or a number that moved
      // accounts between the list loading and Send being pressed.
      const sendingWabaId = (await this.store.getInboxConfig(conv.inboxId))?.wabaId;
      if (tpl.wabaId && sendingWabaId && tpl.wabaId !== sendingWabaId) {
        throw new BadRequestException(
          `The template “${tpl.name}” belongs to a different WhatsApp account and can't be sent from this number. ` +
            "Pick one of this number's own templates.",
        );
      }
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
    // Forward: send this email on to other people as a fresh "Fwd:" thread (email
    // only, non-internal). It's logged here but doesn't reply to the customer.
    const forwardTo =
      !input.internal && sendingEmail ? input.forwardTo?.map((a) => a.trim()).filter(Boolean) : undefined;
    const isForward = Boolean(forwardTo?.length);
    if (isForward && !forwardTo!.every((a) => a.includes("@"))) {
      throw new BadRequestException("Forward needs a valid email address.");
    }
    // Record the subject on email sends so the message can show it. A forward
    // carries the "Fwd:" subject it was actually sent with; a reply carries the
    // thread's subject (just updated above from any edit).
    const emailSubject = !input.internal && sendingEmail
      ? isForward
        ? forwardSubject(conv.subject)
        : conv.subject ?? undefined
      : undefined;
    // Snapshot the sender's signature so the outbound email carries it — appended
    // to the wire body only, never stored on the shown message.
    const signatureHtml =
      !input.internal && sendingEmail ? author.emailSignature?.trim() || undefined : undefined;
    const deliveryMeta: OutboundDeliveryMeta | undefined = input.internal
      ? undefined
      : buildDeliveryMeta(template, emailSubject, cc, bcc, signatureHtml, forwardTo);
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
        forwarded: opts.forwarded,
      },
      author,
    );
    if (!message) throw new NotFoundException(`Conversation ${id} not found`);

    // Broadcast immediately so every open client updates the thread + previews.
    this.realtime.emitMessageCreated(id, message, conv.orgId);

    // An internal note can @-mention teammates → raise a bell notification for
    // each (fire-and-forget; a failed notification never fails the note).
    if (input.internal) {
      void this.notifications.notifyMentions(conv, body, author.name, author.id);
    }

    // Real (non-internal) replies are enqueued for durable delivery. The message
    // is already persisted (status "queued"); the queue drives it to sent/failed
    // with retries, so a crash here never loses it — the recovery sweep re-drives
    // any message left queued/sending.
    if (!input.internal) {
      // An agent reply to the CUSTOMER meets the first-response SLA — stop the
      // clock. A forward goes to a third party, not the customer, so it leaves the
      // SLA running (the customer still hasn't been answered).
      if (!isForward) {
        const cleared = await this.store.setSla(id, null);
        if (cleared) this.realtime.emitConversationUpdated(cleared);
      }
      await this.queue.enqueueDelivery({ messageId: message.id, conversationId: id }, idempotencyKey);
    }
    return message;
  }

  /**
   * Pass one message on to other customers' WhatsApp chats.
   *
   * WhatsApp has no forward primitive — a forward is a fresh send of the same
   * content to a different chat, which is exactly what this does. Media rides
   * along as a cloned attachment row pointing at the same stored object, so
   * forwarding a video costs a row, not a re-upload.
   *
   * Each target is attempted independently and reported separately. The failure
   * that actually happens is per-chat (a closed 24-hour window on one of them),
   * and collapsing that into a single "forward failed" would leave an agent not
   * knowing which of five customers got it.
   */
  async forwardMessage(
    conversationId: string,
    messageId: string,
    contactIds: string[],
    userId: string,
  ): Promise<ForwardResult[]> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");

    const conv = await this.store.getConversation(conversationId);
    if (!conv) throw new NotFoundException(`Conversation ${conversationId} not found`);
    const source = conv.messages.find((m) => m.id === messageId);
    if (!source) throw new NotFoundException("Message not found in this conversation");
    // An internal note is the team talking to itself. Forwarding one to a
    // customer's WhatsApp is the single worst thing this feature could do, so
    // it's refused at the door rather than guarded further down.
    if (source.internal) throw new BadRequestException("Internal notes can't be forwarded.");

    const inbox = (await this.store.listInboxes()).find((i) => i.type === "whatsapp");
    if (!inbox) throw new BadRequestException("No WhatsApp inbox is connected yet.");

    // Dedupe: picking the same customer twice should send once, not twice.
    const targets = [...new Set(contactIds)].slice(0, FORWARD_MAX_TARGETS);
    const results: ForwardResult[] = [];

    for (const contactId of targets) {
      const contact = await this.store.getContactWithConversations(contactId);
      if (!contact) {
        results.push({ contactId, name: "Unknown customer", ok: false, error: "Customer not found" });
        continue;
      }
      const name = contact.displayName;
      if (!contact.phone) {
        results.push({ contactId, name, ok: false, error: "No WhatsApp number on file" });
        continue;
      }
      try {
        const { conversation, created } = await this.store.findOrCreateOpenConversation({
          orgId: me.orgId,
          inboxId: inbox.id,
          contact,
          channel: "whatsapp",
          // Whoever forwards owns the thread they've just started.
          assigneeUserId: me.id,
        });
        if (created) this.realtime.emitConversationUpdated(conversation);

        // Cloned per target: each send claims its own attachment rows, so two
        // targets can't race to claim the same staged upload.
        const attachmentIds = await this.store.stageAttachmentCopies(source.id);
        // A media message with no caption has an empty body, which the send
        // schema allows only because the attachments carry it.
        await this.sendMessage(
          conversation.id,
          {
            body: source.body ?? "",
            internal: false,
            ...(attachmentIds.length ? { attachmentIds } : {}),
          },
          userId,
          { forwarded: true },
        );
        results.push({ contactId, name, ok: true, conversationId: conversation.id });
      } catch (err) {
        // The expected failure here is a closed 24-hour window, and sendMessage
        // already phrases that for an agent. Keep its wording.
        const message = err instanceof Error ? err.message : "Couldn't forward to this chat";
        results.push({ contactId, name, ok: false, error: message });
      }
    }
    return results;
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
    // Handing someone a conversation is work they've just been given — worth a
    // banner. `actorUserId` keeps the common case (an agent replying, which
    // auto-assigns to them) from notifying them about themselves.
    if (conv.assigneeUserId) {
      this.push.notify({
        userIds: [conv.assigneeUserId],
        kind: "assignment",
        title: by ? `${by} assigned you a chat` : "You've been assigned a chat",
        body: conv.contact.displayName,
        conversationId: conv.id,
        actorUserId: byUserId,
      });
    }
    return conv;
  }

  async setStatus(id: string, input: UpdateStatusInput): Promise<Conversation> {
    const conv = await this.store.setStatus(id, input.status);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    // Broadcast so every client drops (or restores) it from the active lists live.
    this.realtime.emitConversationUpdated(conv);
    // A NestChat visitor has a widget open on the other end of this, and closing
    // is the one change that happens to them without anything being said. Keyed
    // on the conversation's origin channel: a thread that merely *replied* over
    // NestChat has no widget waiting on it.
    if (conv.channel === "nestchat") {
      this.nestchat.publishStatusToVisitor(conv.id, conv.status);
    }
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

  /**
   * Agent opened a conversation.
   *
   * **The unread badge belongs to whoever has to reply.** An assigned
   * conversation only clears for its assignee: a teammate opening it to look
   * something up, or glancing at it from the shared inbox, must not take the
   * badge off someone else's queue. That badge is the only thing telling the
   * assignee a customer is waiting on them, and once another person's tap has
   * cleared it the message is gone from their unread list and simply doesn't
   * get answered — a silent failure, and the worst kind for a shared inbox.
   *
   * Unassigned is the other way round on purpose: nobody owns it, the team owns
   * it collectively, and a teammate reading it *is* the team having seen it.
   *
   * The WhatsApp read receipt is deliberately not conditional. It reports a
   * fact about the customer's message — somebody at this business has read it —
   * and that is true whoever opened the thread. Tying it to the badge would
   * make the customer's blue ticks depend on which colleague happened to look,
   * which is both wrong and invisible to us.
   */
  async markRead(id: string, readerUserId?: string): Promise<Conversation> {
    const conv = await this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);

    const owner = conv.assigneeUserId ?? null;
    // No reader id (an internal caller) keeps the old behaviour rather than
    // silently refusing to clear anything.
    const mayClear = !owner || !readerUserId || owner === readerUserId;

    const updated = mayClear ? await this.store.clearUnread(id) : undefined;
    if (updated) this.realtime.emitConversationUpdated(updated);

    if (conv.channel === "whatsapp" || conv.channel === "whatsapp_group") {
      const lastInbound = [...conv.messages]
        .reverse()
        .find((m) => m.direction === "in" && m.channelMsgId);
      if (lastInbound?.channelMsgId) void this.dispatcher.markRead(conv, lastInbound.channelMsgId);
    } else if (conv.channel === "nestchat" && conv.messages.some((m) => m.direction === "in")) {
      // No provider id to quote: the widget is ours and already knows which
      // conversation it is in. Only worth sending if they have written at all.
      void this.dispatcher.markRead(conv);
    }
    return updated ?? conv;
  }

  /** Agent manually marks a conversation unread (WhatsApp-style empty dot).
   *  Internal only — no provider receipt is sent. */
  async markUnread(id: string): Promise<Conversation> {
    const conv = await this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    const updated = await this.store.markUnread(id);
    if (updated) this.realtime.emitConversationUpdated(updated);
    return updated ?? conv;
  }

  /** Replace a conversation's labels with exactly this set (organising/triage). */
  async setLabels(id: string, labelIds: string[]): Promise<Conversation> {
    const updated = await this.store.setConversationLabels(id, labelIds);
    if (!updated) throw new NotFoundException(`Conversation ${id} not found`);
    this.realtime.emitConversationUpdated(updated);
    return updated;
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

  /** Agent is typing: show the customer a "typing…" indicator. On WhatsApp this
   *  only works within the 24-hour window, because it rides on the customer's
   *  last inbound message; on NestChat it goes straight to their open widget. */
  async sendTyping(id: string): Promise<void> {
    const conv = await this.store.getConversation(id);
    if (!conv) return;
    // NestChat has no 24-hour window and nothing to hang the indicator on — the
    // visitor's widget is connected or it isn't.
    if (conv.channel === "nestchat") {
      await this.dispatcher.sendTyping(conv);
      return;
    }
    if (conv.channel !== "whatsapp" && conv.channel !== "whatsapp_group") return;
    if (conv.waWindow && !conv.waWindow.open) return;
    const lastInbound = [...conv.messages]
      .reverse()
      .find((m) => m.direction === "in" && m.channelMsgId);
    if (lastInbound?.channelMsgId) await this.dispatcher.sendTyping(conv, lastInbound.channelMsgId);
  }
}
