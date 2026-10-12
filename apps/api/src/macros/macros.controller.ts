import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createMacroInputSchema,
  updateMacroInputSchema,
  type CreateMacroInput,
  type Macro,
  type UpdateMacroInput,
} from "@ding/schemas";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MacrosService } from "./macros.service";

/** Saved replies for the composer, by team inbox. See docs/macros.md. */
@Controller("macros")
export class MacrosController {
  constructor(private readonly macros: MacrosService) {}

  @Get()
  list(): Promise<Macro[]> {
    return this.macros.list();
  }

  /** What this conversation's composer offers. Before `:id` so it isn't read as one. */
  @Get("conversation/:conversationId")
  forConversation(@Param("conversationId") conversationId: string): Promise<Macro[]> {
    return this.macros.forConversation(conversationId);
  }

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createMacroInputSchema)) body: CreateMacroInput,
  ): Promise<Macro> {
    return this.macros.create(userId, body);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMacroInputSchema)) body: UpdateMacroInput,
  ): Promise<Macro> {
    return this.macros.update(userId, id, body);
  }

  @Delete(":id")
  async remove(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.macros.remove(userId, id);
    return { ok: true };
  }
}
