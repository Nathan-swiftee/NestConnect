import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  addChatMembersInputSchema,
  chatRoomPrefsInputSchema,
  createChatGroupInputSchema,
  editChatMessageInputSchema,
  openDirectChatInputSchema,
  reactChatMessageInputSchema,
  sendChatMessageInputSchema,
  setChatMemberRoleInputSchema,
  setChatModuleInputSchema,
  updateChatGroupInputSchema,
  type AddChatMembersInput,
  type ChatMessage,
  type ChatMessageInfo,
  type ChatMessagePage,
  type ChatPerson,
  type ChatRoom,
  type ChatRoomPrefsInput,
  type ChatRoomSummary,
  type ChatStatusInfo,
  type CreateChatGroupInput,
  type EditChatMessageInput,
  type OpenDirectChatInput,
  type ReactChatMessageInput,
  type SendChatMessageInput,
  type SetChatMemberRoleInput,
  type UpdateChatGroupInput,
} from "@ding/schemas";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ChatService } from "./chat.service";

/** Team Chat — the team talking to itself. See docs/team-chat.md. */
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Answers with the module off too: it's how the apps know to hide it. */
  @Get("status")
  status(@CurrentUserId() userId: string): Promise<ChatStatusInfo> {
    return this.chat.status(userId);
  }

  @Put("module")
  setModule(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(setChatModuleInputSchema)) body: { enabled: boolean },
  ): Promise<ChatStatusInfo> {
    return this.chat.setEnabled(userId, body.enabled);
  }

  /** `?all=1`: an admin's view of every chat in the workspace. */
  @Get("rooms")
  rooms(@CurrentUserId() userId: string, @Query("all") all?: string): Promise<ChatRoomSummary[]> {
    return this.chat.rooms(userId, all === "1" || all === "true");
  }

  @Post("direct")
  openDirect(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(openDirectChatInputSchema)) body: OpenDirectChatInput,
  ): Promise<ChatRoom> {
    return this.chat.openDirect(userId, body.userId);
  }

  @Post("groups")
  createGroup(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createChatGroupInputSchema)) body: CreateChatGroupInput,
  ): Promise<ChatRoom> {
    return this.chat.createGroup(userId, body);
  }

  @Get("rooms/:id")
  room(@CurrentUserId() userId: string, @Param("id") id: string): Promise<ChatRoom> {
    return this.chat.room(userId, id);
  }

  @Patch("rooms/:id")
  updateGroup(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChatGroupInputSchema)) body: UpdateChatGroupInput,
  ): Promise<ChatRoom> {
    return this.chat.updateGroup(userId, id, body);
  }

  @Post("rooms/:id/members")
  addMembers(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addChatMembersInputSchema)) body: AddChatMembersInput,
  ): Promise<ChatRoom> {
    return this.chat.addMembers(userId, id, body);
  }

  @Delete("rooms/:id/members/:userId")
  removeMember(@CurrentUserId() userId: string, @Param("id") id: string, @Param("userId") target: string): Promise<ChatRoom> {
    return this.chat.removeMember(userId, id, target);
  }

  @Put("rooms/:id/members/:userId/role")
  setRole(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Param("userId") target: string,
    @Body(new ZodValidationPipe(setChatMemberRoleInputSchema)) body: SetChatMemberRoleInput,
  ): Promise<ChatRoom> {
    return this.chat.setRole(userId, id, target, body.role);
  }

  @Post("rooms/:id/leave")
  async leave(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.chat.leave(userId, id);
    return { ok: true };
  }

  @Put("rooms/:id/prefs")
  prefs(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(chatRoomPrefsInputSchema)) body: ChatRoomPrefsInput,
  ): Promise<ChatRoomSummary> {
    return this.chat.setPrefs(userId, id, body);
  }

  @Post("rooms/:id/read")
  async read(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.chat.read(userId, id);
    return { ok: true };
  }

  @Post("rooms/:id/delivered")
  async delivered(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.chat.delivered(userId, id);
    return { ok: true };
  }

  @Get("rooms/:id/audits")
  audits(@CurrentUserId() userId: string, @Param("id") id: string): Promise<Array<{ person: ChatPerson; at: string }>> {
    return this.chat.audits(userId, id);
  }

  @Get("rooms/:id/messages")
  messages(@CurrentUserId() userId: string, @Param("id") id: string, @Query("before") before?: string): Promise<ChatMessagePage> {
    return this.chat.messages(userId, id, typeof before === "string" && before ? before : undefined);
  }

  @Post("rooms/:id/messages")
  send(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sendChatMessageInputSchema)) body: SendChatMessageInput,
  ): Promise<ChatMessage> {
    return this.chat.send(userId, id, body);
  }

  @Patch("messages/:id")
  edit(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(editChatMessageInputSchema)) body: EditChatMessageInput,
  ): Promise<ChatMessage> {
    return this.chat.edit(userId, id, body.body);
  }

  @Delete("messages/:id")
  remove(@CurrentUserId() userId: string, @Param("id") id: string): Promise<ChatMessage> {
    return this.chat.remove(userId, id);
  }

  @Post("messages/:id/react")
  react(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reactChatMessageInputSchema)) body: ReactChatMessageInput,
  ): Promise<ChatMessage> {
    return this.chat.react(userId, id, body.emoji);
  }

  @Get("messages/:id/info")
  info(@CurrentUserId() userId: string, @Param("id") id: string): Promise<ChatMessageInfo> {
    return this.chat.info(userId, id);
  }
}
