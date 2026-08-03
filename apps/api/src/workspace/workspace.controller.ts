import { Body, Controller, ForbiddenException, Get, NotFoundException, Post } from "@nestjs/common";
import { createInboxInputSchema, type CreateInboxInput } from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";

/** Workspace bootstrap data for the app shell: who am I, my inboxes, my sidebar. */
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

  /** Create + route a new inbox (admins and managers only). */
  @Post("inboxes")
  async createInbox(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createInboxInputSchema)) body: CreateInboxInput,
  ) {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can create inboxes");
    }
    return this.store.createInbox({ orgId: me.orgId, ...body });
  }
}
