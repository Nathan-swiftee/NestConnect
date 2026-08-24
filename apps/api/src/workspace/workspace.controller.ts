import {
  Body,
  ConflictException,
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
  createLabelInputSchema,
  createTeamInputSchema,
  createUserInputSchema,
  reorderTeamsInputSchema,
  updateInboxInputSchema,
  updateLabelInputSchema,
  updateMyPreferencesInputSchema,
  updateMyProfileInputSchema,
  updateTeamInputSchema,
  updateUserInputSchema,
  type CreateInboxInput,
  type CreateLabelInput,
  type CreateTeamInput,
  type CreateUserInput,
  type ReorderTeamsInput,
  type UpdateInboxInput,
  type UpdateLabelInput,
  type UpdateMyPreferencesInput,
  type UpdateMyProfileInput,
  type UpdateTeamInput,
  type UpdateUserInput,
  type User,
} from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { Mailer } from "../mail/mailer.service";
import { MetaOAuthService } from "../channels/meta/meta-oauth.service";
import { sanitizeOutboundHtml } from "../channels/email/html-sanitize";
import { env } from "../config/env";

/** Workspace bootstrap data for the app shell, plus the Settings admin surface. */
@Controller()
export class WorkspaceController {
  constructor(
    private readonly store: Store,
    private readonly mailer: Mailer,
    private readonly metaOAuth: MetaOAuthService,
  ) {}

  /** Subscribe a WhatsApp number's WhatsApp Business Account to our app so its
   *  inbound messages + delivery statuses reach our webhook. The one-click OAuth
   *  connect already does this; this covers the manual "paste a token" path, which
   *  otherwise leaves the WABA unsubscribed (no inbound, no ticks). Needs the WABA
   *  id — no-op (logged) without it. Non-fatal: never blocks saving the channel. */
  private async subscribeWhatsAppWebhook(inboxId: string, type: string): Promise<void> {
    if (type !== "whatsapp" && type !== "whatsapp_group") return;
    const config = await this.store.getInboxConfig(inboxId);
    const wabaId = config?.wabaId;
    const accessToken = config?.accessToken;
    if (wabaId && accessToken) await this.metaOAuth.subscribeApp(wabaId, accessToken);
  }

  @Get("me")
  async me(@CurrentUserId() userId: string) {
    // Same shape as /auth/session, 2FA policy included — the two are one type on
    // the client, so they must not drift.
    return { ...(await this.store.me(userId)), twoFactorEnforced: env.auth.require2fa };
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

  /** A user updating their OWN profile — name, login email, photo. */
  @Patch("me/profile")
  async updateMyProfile(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(updateMyProfileInputSchema)) body: UpdateMyProfileInput,
  ): Promise<User> {
    const params: { name?: string; email?: string; avatarUrl?: string | null } = {};
    if (body.name !== undefined) params.name = body.name.trim();
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      // Login is by email — keep it unique within the org.
      const existing = await this.store.findUserByEmail(email);
      if (existing && existing.id !== userId) {
        throw new ConflictException("That email address is already in use.");
      }
      params.email = email;
    }
    // Empty string clears the photo (back to Gravatar / initials).
    if (body.avatarUrl !== undefined) params.avatarUrl = body.avatarUrl?.trim() || null;
    const user = await this.store.updateMyProfile(userId, params);
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
    const inbox = await this.store.createInbox({ orgId: me.orgId, ...body });
    await this.subscribeWhatsAppWebhook(inbox.id, inbox.type);
    return inbox;
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
    await this.subscribeWhatsAppWebhook(inbox.id, inbox.type);
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

  /* ---- labels: catalogue read (any agent) + management (managers) ---- */
  @Get("labels")
  async listLabels(@CurrentUserId() userId: string) {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    return this.store.listLabels(me.orgId);
  }

  @Post("labels")
  async createLabel(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createLabelInputSchema)) body: CreateLabelInput,
  ) {
    const me = await this.requireManager(userId);
    return this.store.createLabel({ orgId: me.orgId, name: body.name, color: body.color });
  }

  @Patch("labels/:id")
  async updateLabel(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLabelInputSchema)) body: UpdateLabelInput,
  ) {
    await this.requireManager(userId);
    const label = await this.store.updateLabel(id, body);
    if (!label) throw new NotFoundException("Label not found");
    return label;
  }

  @Delete("labels/:id")
  async deleteLabel(@CurrentUserId() userId: string, @Param("id") id: string) {
    await this.requireManager(userId);
    await this.store.deleteLabel(id);
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
    const { sent } = await this.mailer.sendInvite(user.email, user.name, url);
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
