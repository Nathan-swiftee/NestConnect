import {
  BadRequestException,
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
  createCustomFieldInputSchema,
  customFieldEntitySchema,
  setCustomFieldValuesInputSchema,
  updateCustomFieldInputSchema,
  type CreateCustomFieldInput,
  type CustomField,
  type CustomFieldEntity,
  type CustomFieldValue,
  type SetCustomFieldValuesInput,
  type UpdateCustomFieldInput,
} from "@ding/schemas";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ORG_ID } from "../data/fixtures";
import { Store } from "../data/store";

/**
 * Custom fields: the definitions, and the values recorded against them.
 *
 * Two different permissions on purpose. Defining a field changes what every
 * screen in the workspace shows and what an integration is allowed to send — an
 * admin or manager decision. *Filling one in* is the job: an agent on a call
 * types the order number the customer just read out, and making that a
 * manager's job would mean it never gets typed.
 */
@Controller("custom-fields")
export class CustomFieldsController {
  constructor(private readonly store: Store) {}

  /** Every definition, archived included — a pane has to show what is retired
   *  in order to offer bringing it back. */
  @Get()
  list(): Promise<CustomField[]> {
    return this.store.listCustomFields(ORG_ID);
  }

  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createCustomFieldInputSchema)) body: CreateCustomFieldInput,
  ): Promise<CustomField> {
    await this.requireManager(userId);
    // `select` with nothing to select is a field an agent can look at and never
    // fill in, which reads as broken rather than as unfinished.
    if (body.type === "select" && !body.options.length) {
      throw new BadRequestException("A choice field needs at least one option");
    }
    const existing = await this.store.listCustomFields(ORG_ID);
    if (existing.some((f) => f.key === body.key)) {
      throw new BadRequestException(`A field with the key “${body.key}” already exists`);
    }
    return this.store.createCustomField(ORG_ID, body);
  }

  @Patch(":id")
  async update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomFieldInputSchema)) body: UpdateCustomFieldInput,
  ): Promise<CustomField> {
    await this.requireManager(userId);
    if (body.type === "select" && body.options && !body.options.length) {
      throw new BadRequestException("A choice field needs at least one option");
    }
    const field = await this.store.updateCustomField(id, body);
    if (!field) throw new NotFoundException("Field not found");
    return field;
  }

  /**
   * Delete a field and every value recorded against it.
   *
   * Archiving is the reversible option and what the pane offers first; this is
   * the deliberate one. It is here rather than folded into the patch because
   * "set archived: false" and "destroy a year of order numbers" should not be
   * the same request with a different flag.
   */
  @Delete(":id")
  async remove(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<{ ok: boolean }> {
    await this.requireManager(userId);
    await this.store.deleteCustomField(id);
    return { ok: true };
  }

  /** The values on one record. */
  @Get(":entity/:entityId")
  async values(
    @Param("entity") entity: string,
    @Param("entityId") entityId: string,
  ): Promise<CustomFieldValue[]> {
    const kind = this.entity(entity);
    const map = await this.store.customFieldValues(ORG_ID, kind, [entityId]);
    return map.get(entityId) ?? [];
  }

  /**
   * Write values on one record. Null clears a field.
   *
   * Any signed-in user may: this is the agent typing what the customer just
   * told them. Keys the workspace has not defined come back in `unknown` rather
   * than being stored — a typo in an integration should be visible at the point
   * it is made, not discovered a year later as a table of values no screen
   * reads.
   */
  @Post(":entity/:entityId")
  async setValues(
    @Param("entity") entity: string,
    @Param("entityId") entityId: string,
    @Body(new ZodValidationPipe(setCustomFieldValuesInputSchema)) body: SetCustomFieldValuesInput,
  ): Promise<{ values: CustomFieldValue[]; unknown: string[] }> {
    return this.store.setCustomFieldValues(ORG_ID, this.entity(entity), entityId, body.values);
  }

  /** A path segment is not a validated body, so it is checked here. */
  private entity(raw: string): CustomFieldEntity {
    const parsed = customFieldEntitySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException("Unknown record type");
    return parsed.data;
  }

  private async requireManager(userId: string): Promise<void> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can change custom fields");
    }
  }
}
