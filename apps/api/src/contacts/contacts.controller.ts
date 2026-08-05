import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createContactInputSchema,
  updateContactInputSchema,
  type CreateContactInput,
  type UpdateContactInput,
} from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";

/** The customer directory (CRM): list, view, add, tag and pin-route contacts. */
@Controller("contacts")
export class ContactsController {
  constructor(private readonly store: Store) {}

  @Get()
  list() {
    return this.store.listContacts();
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const contact = await this.store.getContactWithConversations(id);
    if (!contact) throw new NotFoundException("Customer not found");
    return contact;
  }

  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createContactInputSchema)) body: CreateContactInput,
  ) {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    return this.store.createContact({ orgId: me.orgId, ...body });
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateContactInputSchema)) body: UpdateContactInput,
  ) {
    const contact = await this.store.updateContact(id, body);
    if (!contact) throw new NotFoundException("Customer not found");
    return contact;
  }
}
