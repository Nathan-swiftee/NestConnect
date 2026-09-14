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
  createTemplateInputSchema,
  setChannelTemplateInputSchema,
  setDefaultTemplateInputSchema,
  updateTemplateInputSchema,
  type CreateTemplateInput,
  type SetChannelTemplateInput,
  type SetDefaultTemplateInput,
  type Template,
  type UpdateTemplateInput,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { Store } from "../data/store";
import { TemplatesService } from "./templates.service";

/**
 * WhatsApp message templates. Anyone signed in can list them (the composer needs
 * them to reply once a 24-hour window has closed); creating, editing, deleting
 * and syncing from Meta are manager/admin only.
 */
@Controller("templates")
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly store: Store,
  ) {}

  @Get()
  list(): Promise<Template[]> {
    return this.templates.list();
  }

  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createTemplateInputSchema)) body: CreateTemplateInput,
  ): Promise<Template> {
    await this.requireManager(userId);
    return this.templates.create(body);
  }

  @Patch(":id")
  async update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTemplateInputSchema)) body: UpdateTemplateInput,
  ): Promise<Template> {
    await this.requireManager(userId);
    return this.templates.update(id, body);
  }

  @Delete(":id")
  async remove(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: boolean }> {
    await this.requireManager(userId);
    await this.templates.remove(id);
    return { ok: true };
  }

  /** Choose the workspace's default template (or clear it with null). Declared
   *  before the ":id" routes so "default" isn't swallowed as an id. */
  @Post("default")
  async setDefault(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(setDefaultTemplateInputSchema)) body: SetDefaultTemplateInput,
  ): Promise<Template[]> {
    await this.requireManager(userId);
    return this.templates.setDefault(body.templateId);
  }

  /**
   * Point one WhatsApp number at its own closed-window template.
   *
   * Separate from "default" above because they answer different questions: that
   * one sets the account-wide fallback, this one overrides it for a single
   * number. Two numbers under one account are usually two different things to
   * be, and before this the second one could only have the first one's answer.
   */
  @Post("channel-default")
  async setChannelDefault(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(setChannelTemplateInputSchema)) body: SetChannelTemplateInput,
  ): Promise<Template[]> {
    await this.requireManager(userId);
    return this.templates.setChannelDefault(body.inboxId, body.templateId);
  }

  @Post("sync")
  async sync(@CurrentUserId() userId: string): Promise<{ synced: number; pruned: number }> {
    await this.requireManager(userId);
    return this.templates.syncFromMeta();
  }

  private async requireManager(userId: string): Promise<void> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can manage templates");
    }
  }
}
