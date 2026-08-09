import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createInboxInputSchema,
  createTeamInputSchema,
  createUserInputSchema,
  reorderTeamsInputSchema,
  updateInboxInputSchema,
  updateMyPreferencesInputSchema,
  updateTeamInputSchema,
  updateUserInputSchema,
  type CreateInboxInput,
  type CreateTeamInput,
  type CreateUserInput,
  type ReorderTeamsInput,
  type UpdateInboxInput,
  type UpdateMyPreferencesInput,
  type UpdateTeamInput,
  type UpdateUserInput,
  type User,
} from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { InviteMailer } from "../auth/invite-mailer";
import { sanitizeOutboundHtml } from "../channels/email/html-sanitize";
import { env } from "../config/env";

/** Workspace bootstrap data for the app shell, plus the Settings admin surface. */
@Controller()
export class WorkspaceController {
  constructor(
    private readonly store: Store,
    private readonly invites: InviteMailer,
  ) {}

  @Get("me")
  me(@CurrentUserId() userId: string) {
    return this.store.me(userId);
  }

  /** A user updating their OWN availability + email signature (no admin rights). */
  @Patch("me/preferences")
  async updateMyPreferences(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(updateMyPreferencesInputSchema)) body: UpdateMyPreferencesInput,
  ): Promise<User> {
    const params: { available?: boolean; emailSignature?: string | null } = {};
    if (body.available !== undefined) params.available = body.available;
    if (body.emailSignature !== undefined) {
      // Sanitize the agent's rich signature (keeps formatting + inline images,
      // strips scripts) — the same treatment an outbound email body gets.
      const clean = body.emailSignature ? sanitizeOutboundHtml(body.emailSignature) : "";
      params.emailSignature = clean || null;
    }
    const user = await this.store.updateMyPreferences(userId, params);
    if (!user) throw new NotFoundException("Current user not found");
    return user;
  }

  @Get("inboxes")
  inboxes() {
    return this.store.listInboxes();
  }

  @Get("views")
  views(@CurrentUserId() userId: string) {
    return this.store.views(userId);
  }

  /* ---- Settings ---- */

  @Get("settings/teams")
  teams() {
    return this.store.listTeams();
  }

  @Get("settings/people")
  people() {
    return this.store.listMembers();
  }

  /** Create + route a new channel (inbox). Admins and managers only. */
  @Post("inboxes")
  async createInbox(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createInboxInputSchema)) body: CreateInboxInput,
  ) {
    const me = await this.requireManager(userId);
    return this.store.createInbox({ orgId: me.orgId, ...body });
  }

  @Patch("inboxes/:id")
  async updateInbox(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateInboxInputSchema)) body: UpdateInboxInput,
  ) {
    await this.requireManager(userId);
    const inbox = await this.store.updateInbox(id, body);
    if (!inbox) throw new NotFoundException("Channel not found");
    return inbox;
  }

  @Delete("inboxes/:id")
  async deleteInbox(@CurrentUserId() userId: string, @Param("id") id: string) {
    await this.requireManager(userId);
    await this.store.deleteInbox(id);
    return { ok: true };
  }

  /** Move this channel's still-open conversations onto its current routing. */
  @Post("inboxes/:id/reroute")
  async rerouteInbox(@CurrentUserId() userId: string, @Param("id") id: string) {
    await this.requireManager(userId);
    const moved = await this.store.rerouteInboxConversations(id);
    return { moved };
  }

  @Post("settings/teams")
  async createTeam(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createTeamInputSchema)) body: CreateTeamInput,
  ) {
    const me = await this.requireManager(userId);
    return this.store.createTeam({ orgId: me.orgId, name: body.name, icon: body.icon });
  }

  @Post("settings/teams/reorder")
  async reorderTeams(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(reorderTeamsInputSchema)) body: ReorderTeamsInput,
  ) {
    await this.requireManager(userId);
    return this.store.reorderTeams(body.orderedIds);
  }

  @Patch("settings/teams/:id")
  async updateTeam(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTeamInputSchema)) body: UpdateTeamInput,
  ) {
    await this.requireManager(userId);
    const team = await this.store.updateTeam(id, body);
    if (!team) throw new NotFoundException("Team not found");
    return team;
  }

  @Delete("settings/teams/:id")
  async deleteTeam(@CurrentUserId() userId: string, @Param("id") id: string) {
    await this.requireManager(userId);
    await this.store.deleteTeam(id);
    return { ok: true };
  }

  @Post("settings/people")
  async createUser(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createUserInputSchema)) body: CreateUserInput,
  ) {
    const me = await this.requireManager(userId);
    // No password → the store mints an invite token; email the "set your
    // password" link, and return it so the admin can share it by hand when no
    // transactional email is connected yet.
    const { user, inviteToken } = await this.store.createUser({ orgId: me.orgId, ...body });
    if (!inviteToken) return { user };
    const url = `${env.appUrl}/?invite=${inviteToken}`;
    const { sent } = await this.invites.sendInvite(user.email, user.name, url);
    return { user, invite: { url, emailed: sent } };
  }

  @Patch("settings/people/:id")
  async updateUser(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserInputSchema)) body: UpdateUserInput,
  ) {
    await this.requireManager(userId);
    const user = await this.store.updateUser(id, body);
    if (!user) throw new NotFoundException("Person not found");
    return user;
  }

  @Delete("settings/people/:id")
  async deleteUser(@CurrentUserId() userId: string, @Param("id") id: string) {
    await this.requireManager(userId);
    if (id === userId) throw new ForbiddenException("You can't remove your own account");
    await this.store.deleteUser(id);
    return { ok: true };
  }

  private async requireManager(userId: string): Promise<User> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can change settings");
    }
    return me;
  }
}
