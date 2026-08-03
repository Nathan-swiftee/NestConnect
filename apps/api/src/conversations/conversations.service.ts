import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AssignConversationInput,
  Conversation,
  ConversationWithMessages,
  Message,
  SendMessageInput,
} from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(view: string, userId: string): Conversation[] {
    return this.store.listConversations(view, userId);
  }

  get(id: string): ConversationWithMessages {
    const conv = this.store.getConversation(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  sendMessage(id: string, input: SendMessageInput, userId: string): Message {
    const author = this.store.getUser(userId);
    if (!author) throw new NotFoundException("Current user not found");
    const message = this.store.addMessage(id, input, author);
    if (!message) throw new NotFoundException(`Conversation ${id} not found`);
    // Broadcast so every open client updates the thread and list previews live.
    this.realtime.emitMessageCreated(id, message);
    return message;
  }

  assign(id: string, input: AssignConversationInput, byUserId: string): Conversation {
    const conv = this.store.assign(id, input);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    const by = this.store.getUser(byUserId)?.name;
    this.realtime.emitConversationAssigned(conv, by);
    return conv;
  }
}
