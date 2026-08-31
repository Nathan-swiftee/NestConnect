import { Body, Controller, ForbiddenException, Get, Param, Put } from "@nestjs/common";
import { updateNestchatInputSchema, type UpdateNestchatInput } from "@ding/schemas";
import { Store } from "../../data/store";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { NestChatService } from "./nestchat.service";

/**
 * The agent-facing half of NestChat: reading and editing how a channel's widget
 * looks, and the snippet to paste into a website.
 *
 * Separate from the visitor controller because the two have opposite postures —
 * that one answers strangers and is `@Public()`, this one is behind the session
 * guard like the rest of Settings, and editing needs a manager.
 */
@Controller("settings/nestchat")
export class NestChatAdminController {
  constructor(
    private readonly nestchat: NestChatService,
    private readonly store: Store,
  ) {}

  @Get(":inboxId")
  async settings(@Param("inboxId") inboxId: string) {
    return this.nestchat.settingsFor(inboxId);
  }

  @Put(":inboxId")
  async update(
    @CurrentUserId() userId: string,
    @Param("inboxId") inboxId: string,
    @Body(new ZodValidationPipe(updateNestchatInputSchema)) body: UpdateNestchatInput,
  ) {
    await this.requireManager(userId);
    return this.nestchat.updateAppearance(inboxId, body.appearance);
  }

  /** How a channel looks to the public is a channel setting, so it takes the
   *  same role as connecting one. */
  private async requireManager(userId: string): Promise<void> {
    const me = await this.store.getUser(userId);
    if (!me || (me.role !== "admin" && me.role !== "manager")) {
      throw new ForbiddenException("Managers and admins only");
    }
  }
}
