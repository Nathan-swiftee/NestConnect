import { Body, Controller, ForbiddenException, Get, Post } from "@nestjs/common";
import {
  createWorkspaceInputSchema,
  type CreateWorkspaceInput,
  type CreatedWorkspace,
  type PlatformWorkspace,
} from "@ding/schemas";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { env } from "../config/env";
import { Store } from "../data/store";
import { Mailer } from "../mail/mailer.service";
import { isPlatformOwner } from "../tenancy/platform-owner";
import { runInTenant } from "../tenancy/tenant-scope";

/**
 * The platform's owners, above any one workspace: every workspace there is,
 * and new ones. Opening one is a workspace switch (POST /auth/switch), which
 * adds an owner to a workspace they aren't in yet as an admin.
 */
@Controller("platform")
export class PlatformController {
  constructor(
    private readonly store: Store,
    private readonly mailer: Mailer,
  ) {}

  @Get("workspaces")
  async list(@CurrentUserId() userId: string): Promise<PlatformWorkspace[]> {
    await this.requireOwner(userId);
    const mine = new Set((await this.store.listMemberships(userId)).map((m) => m.user.orgId));
    return (await this.store.listWorkspaces()).map((w) => ({ ...w, joined: mine.has(w.id) }));
  }

  /**
   * A new workspace and the person who'll run it: its first admin, on a first
   * team ("General") so routing and Team Chat have somewhere to start. Someone
   * new is invited to set a password; someone who already signs in is told
   * they've been added, and finds it among their workspaces.
   */
  @Post("workspaces")
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createWorkspaceInputSchema)) body: CreateWorkspaceInput,
  ): Promise<CreatedWorkspace> {
    await this.requireOwner(userId);
    const ws = await this.store.createWorkspace(body.name);
    const admin = await runInTenant(ws.id, async () => {
      const team = await this.store.createTeam({ orgId: ws.id, name: "General" });
      const { user, inviteToken, joinedExisting } = await this.store.createUser({
        orgId: ws.id,
        name: body.adminName,
        email: body.adminEmail,
        role: "admin",
        teamIds: [team.id],
      });
      if (joinedExisting) {
        const { sent } = await this.mailer.sendAddedToWorkspace(user.email, user.name, ws.name, env.appUrl).catch(() => ({ sent: false }));
        return { name: user.name, email: user.email, invited: false, emailed: sent };
      }
      if (!inviteToken) return { name: user.name, email: user.email, invited: false, emailed: false };
      const url = `${env.appUrl}/?invite=${inviteToken}`;
      const { sent } = await this.mailer.sendInvite(user.email, user.name, url, ws.name).catch(() => ({ sent: false }));
      return { name: user.name, email: user.email, invited: true, emailed: sent, inviteUrl: url };
    });
    const summary = (await this.store.listWorkspaces()).find((w) => w.id === ws.id)!;
    const mine = (await this.store.listMemberships(userId)).some((m) => m.user.orgId === ws.id);
    return { workspace: { ...summary, joined: mine }, admin };
  }

  private async requireOwner(userId: string): Promise<void> {
    if (!(await isPlatformOwner(this.store, userId))) throw new ForbiddenException("Only the platform's owners manage workspaces");
  }
}
