import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AssignConversationInput,
  Conversation,
  ConversationWithMessages,
  Message,
  SendMessageInput,
  UpdateStatusInput,
} from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ChannelDispatcher } from "../channels/channel-dispatcher";

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

    const message = await this.store.addMessage(id, input, author);
    if (!message) throw new NotFoundException(`Conversation ${id} not found`);

    // Broadcast immediately so every open client updates the thread + previews.
    this.realtime.emitMessageCreated(id, message);

    // Dispatch real (non-internal) replies out through the channel provider.
    if (!input.internal) {
      const conv = await this.store.getConversation(id);
      if (conv) void this.dispatcher.dispatchOutbound(conv, message);
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
}
