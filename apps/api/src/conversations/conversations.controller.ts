import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  assignConversationInputSchema,
  reactionInputSchema,
  sendMessageInputSchema,
  snoozeInputSchema,
  updatePriorityInputSchema,
  updateStatusInputSchema,
  type AssignConversationInput,
  type ReactionInput,
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
  list(
    @CurrentUserId() userId: string,
    @Query("view") view?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.conversations.list(view ?? "inbound", userId, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Global search across all conversations (declared before :id so it matches). */
  @Get("search")
  search(
    @Query("q") q?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.conversations.search(q ?? "", { cursor, limit: limit ? Number(limit) : undefined });
  }

  /** Older messages in a thread (scroll-up history), before a seq cursor. */
  @Get(":id/messages")
  messages(
    @Param("id") id: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ) {
    return this.conversations.messages(id, { before, limit: limit ? Number(limit) : undefined });
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

  /** Agent started typing — show the customer a WhatsApp "typing…" indicator. */
  @Post(":id/typing")
  async typing(@Param("id") id: string): Promise<{ ok: boolean }> {
    await this.conversations.sendTyping(id);
    return { ok: true };
  }

  /** React to a message with an emoji (empty removes the agent's reaction). */
  @Post(":id/messages/:messageId/react")
  react(
    @Param("id") id: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(reactionInputSchema)) body: ReactionInput,
  ) {
    return this.conversations.react(id, messageId, body.emoji);
  }

  /** Manually retry a failed outbound message (re-queues it for delivery). */
  @Post(":id/messages/:messageId/retry")
  retry(@Param("messageId") messageId: string) {
    return this.conversations.retryMessage(messageId);
  }

  @Post(":id/priority")
  setPriority(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePriorityInputSchema)) body: UpdatePriorityInput,
  ) {
    return this.conversations.setPriority(id, body);
  }
}
