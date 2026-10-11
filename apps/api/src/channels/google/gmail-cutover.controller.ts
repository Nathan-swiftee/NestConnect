import { BadRequestException, Body, Controller, ForbiddenException, Get, Post } from "@nestjs/common";
import { EMAIL_CUTOVER_CONFIRM, type EmailCutoverJob, type EmailCutoverPreview } from "@ding/schemas";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { Store } from "../../data/store";
import { SandboxPolicy } from "../../tenancy/sandbox";
import { GmailCutoverService } from "./gmail-cutover.service";

/**
 * Settings → Move from Gmail. Admins only: a run deletes every email
 * conversation in the workspace, which no undo brings back.
 */
@Controller("settings/email-cutover")
export class GmailCutoverController {
  constructor(
    private readonly store: Store,
    private readonly cutover: GmailCutoverService,
    private readonly sandbox: SandboxPolicy,
  ) {}

  @Get()
  async preview(@CurrentUserId() userId: string): Promise<EmailCutoverPreview & { job: EmailCutoverJob }> {
    const orgId = await this.adminOrg(userId);
    return { ...(await this.cutover.preview()), job: this.cutover.status(orgId) };
  }

  @Get("status")
  async status(@CurrentUserId() userId: string): Promise<EmailCutoverJob> {
    return this.cutover.status(await this.adminOrg(userId));
  }

  @Post()
  async run(@CurrentUserId() userId: string, @Body() body: { confirm?: string }): Promise<EmailCutoverJob> {
    const orgId = await this.adminOrg(userId);
    await this.sandbox.assertLive("Moving from Gmail");
    if (body?.confirm !== EMAIL_CUTOVER_CONFIRM) {
      throw new BadRequestException(`Type ${EMAIL_CUTOVER_CONFIRM} to confirm`);
    }
    try {
      return this.cutover.start(orgId);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  private async adminOrg(userId: string): Promise<string> {
    const me = await this.store.getUser(userId);
    if (!me || me.role !== "admin") throw new ForbiddenException("Only an admin can move the workspace from Gmail");
    return me.orgId;
  }
}
