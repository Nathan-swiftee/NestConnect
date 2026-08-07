import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AssignConversationInput,
  Conversation,
  ConversationWithMessages,
  Message,
  SendMessageInput,
  UpdatePriorityInput,
  UpdateStatusInput,
} from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ChannelDispatcher } from "../channels/channel-dispatcher";
import type { OutboundTemplate } from "../channels/channel-provider";

/** Fill a template body's {{1}}, {{2}} … positional variables from `params`. */
function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
    private readonly dispatcher: ChannelDispatcher,
  ) {}

  list(view: string, userId: string): Promise<Conversation[]> {
    return this.store.listConversations(view, userId);
  }

  async get(id: string): Promise<ConversationWithMessages> {
    const conv = await this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async sendMessage(id: string, input: SendMessageInput, userId: string): Promise<Message> {
    const author = await this.store.getUser(userId);
    if (!author) throw new NotFoundException("Current user not found");

    // A template send: resolve it and render the body from its variables.
    let template: OutboundTemplate | undefined;
    let body = input.body;
    if (input.template) {
      const tpl = await this.store.getTemplate(input.template.id);
      if (!tpl) throw new NotFoundException("Template not found");
      body = fillTemplate(tpl.body, input.template.params);
      template = { name: tpl.name, language: tpl.language, params: input.template.params };
    }

    // Enforce WhatsApp's 24-hour window: a free-form reply is only allowed while
    // the window is open — once closed, an approved template is the only way in.
    if (!input.internal && !template) {
      const current = await this.store.getConversation(id);
      if (current?.waWindow && !current.waWindow.open) {
        throw new BadRequestException(
          "This WhatsApp conversation's 24-hour window has closed — send an approved template to reply.",
        );
      }
    }

    const message = await this.store.addMessage(
      id,
      { body, internal: input.internal, attachmentIds: input.attachmentIds },
      author,
    );
    if (!message) throw new NotFoundException(`Conversation ${id} not found`);

    // Broadcast immediately so every open client updates the thread + previews.
    this.realtime.emitMessageCreated(id, message);

    // Dispatch real (non-internal) replies out through the channel provider.
    if (!input.internal) {
      // An agent reply meets the first-response SLA — stop the clock.
      const cleared = await this.store.setSla(id, null);
      if (cleared) this.realtime.emitConversationUpdated(cleared);
      const conv = await this.store.getConversation(id);
      if (conv) void this.dispatcher.dispatchOutbound(conv, message, template);
    }
    return message;
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
}
