import { Body, Controller, ForbiddenException, Get, Param, Patch } from "@nestjs/common";
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

  /**
   * Save any combination of the three sections.
   *
   * Each is applied only when it was sent, so the pane can save the whole form
   * in one call while a narrower caller (a future API client, a migration)
   * touches one section without having to restate the other two.
   *
   * `updateRouting` is the one that can refuse: an option pointing at a team
   * this channel doesn't route to is rejected rather than stored, because the
   * widget's own header would then be advertising the wrong people. It runs
   * before the settings are re-read so a rejected save changes nothing at all.
   */
  @Patch(":inboxId")
  async update(
    @CurrentUserId() userId: string,
    @Param("inboxId") inboxId: string,
    @Body(new ZodValidationPipe(updateNestchatInputSchema)) body: UpdateNestchatInput,
  ) {
    await this.requireManager(userId);
    if (body.routing) await this.nestchat.updateRouting(inboxId, body.routing);
    if (body.preChat) await this.nestchat.updatePreChat(inboxId, body.preChat);
    if (body.appearance) return this.nestchat.updateAppearance(inboxId, body.appearance);
    return this.nestchat.settingsFor(inboxId);
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
