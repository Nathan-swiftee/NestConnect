import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  assignConversationInputSchema,
  sendMessageInputSchema,
  type AssignConversationInput,
  type SendMessageInput,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Store } from "../data/store";
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly store: Store,
  ) {}

  /** Current user — hardcoded to the demo user until auth lands. */
  private get me() {
    return this.store.demoUserId;
  }

  @Get()
  list(@Query("view") view?: string) {
    return this.conversations.list(view ?? "inbound", this.me);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.conversations.get(id);
  }

  @Post(":id/messages")
  send(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sendMessageInputSchema)) body: SendMessageInput,
  ) {
    return this.conversations.sendMessage(id, body, this.me);
  }

  @Post(":id/assign")
  assign(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignConversationInputSchema)) body: AssignConversationInput,
  ) {
    return this.conversations.assign(id, body, this.me);
  }
}
