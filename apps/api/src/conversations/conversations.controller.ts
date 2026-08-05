import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  assignConversationInputSchema,
  sendMessageInputSchema,
  snoozeInputSchema,
  updateStatusInputSchema,
  type AssignConversationInput,
  type SendMessageInput,
  type SnoozeInput,
  type UpdateStatusInput,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUserId() userId: string, @Query("view") view?: string) {
    return this.conversations.list(view ?? "inbound", userId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.conversations.get(id);
  }

  @Post(":id/messages")
  send(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sendMessageInputSchema)) body: SendMessageInput,
  ) {
    return this.conversations.sendMessage(id, body, userId);
  }

  @Post(":id/assign")
  assign(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignConversationInputSchema)) body: AssignConversationInput,
  ) {
    return this.conversations.assign(id, body, userId);
  }

  @Post(":id/status")
  setStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStatusInputSchema)) body: UpdateStatusInput,
  ) {
    return this.conversations.setStatus(id, body);
  }

  @Post(":id/snooze")
  snooze(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(snoozeInputSchema)) body: SnoozeInput,
  ) {
    return this.conversations.snooze(id, body.until);
  }
}
