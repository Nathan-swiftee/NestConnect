import { Body, Controller, Delete, NotFoundException, Param, Post } from "@nestjs/common";
import { createGroupInputSchema, type CreateGroupInput } from "@ding/schemas";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { Store } from "../../data/store";
import { GroupsService } from "./groups.service";

@Controller("groups")
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly store: Store,
  ) {}

  /** Create a WhatsApp group space (admins/managers only). */
  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createGroupInputSchema)) body: CreateGroupInput,
  ) {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    return this.groups.createGroup(body);
  }

  /** Revoke and regenerate the group's invite link. */
  @Post(":id/invite/reset")
  resetInvite(@Param("id") id: string) {
    return this.groups.resetInviteLink(id);
  }

  /** Remove a member from the group (Meta confirms via webhook). */
  @Delete(":id/participants/:contactId")
  async removeParticipant(@Param("id") id: string, @Param("contactId") contactId: string) {
    await this.groups.removeParticipant(id, contactId);
    return { ok: true };
  }
}
