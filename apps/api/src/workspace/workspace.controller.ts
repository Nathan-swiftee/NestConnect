import { Body, Controller, ForbiddenException, Get, NotFoundException, Post } from "@nestjs/common";
import {
  createInboxInputSchema,
  createTeamInputSchema,
  createUserInputSchema,
  type CreateInboxInput,
  type CreateTeamInput,
  type CreateUserInput,
  type User,
} from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";

/** Workspace bootstrap data for the app shell, plus the Settings admin surface. */
@Controller()
export class WorkspaceController {
  constructor(private readonly store: Store) {}

  @Get("me")
  me(@CurrentUserId() userId: string) {
    return this.store.me(userId);
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

  @Post("settings/teams")
  async createTeam(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createTeamInputSchema)) body: CreateTeamInput,
  ) {
    const me = await this.requireManager(userId);
    return this.store.createTeam({ orgId: me.orgId, name: body.name });
  }

  @Post("settings/people")
  async createUser(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createUserInputSchema)) body: CreateUserInput,
  ) {
    const me = await this.requireManager(userId);
    return this.store.createUser({ orgId: me.orgId, ...body });
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
