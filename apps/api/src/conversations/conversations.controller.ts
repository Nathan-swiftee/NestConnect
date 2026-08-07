import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  assignConversationInputSchema,
  sendMessageInputSchema,
  snoozeInputSchema,
  updatePriorityInputSchema,
  updateStatusInputSchema,
  type AssignConversationInput,
  type SendMessageInput,
  type SnoozeInput,
  type UpdatePriorityInput,
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

  /** Mark a conversation read — clears the unread badge + sends a WhatsApp read receipt. */
  @Post(":id/read")
  markRead(@Param("id") id: string) {
    return this.conversations.markRead(id);
  }

  @Post(":id/priority")
  setPriority(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePriorityInputSchema)) body: UpdatePriorityInput,
  ) {
    return this.conversations.setPriority(id, body);
  }
}
