import {
  BadRequestException,
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
  reachInputSchema,
  updateContactInputSchema,
  type CreateContactInput,
  type ReachInput,
  type UpdateContactInput,
} from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";

/** The customer directory (CRM): list, view, add, tag and pin-route contacts. */
@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
  ) {}

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

  /** Reach this customer on a channel: return their open conversation there, or
   *  start a fresh one (assigned to the agent reaching out). Lets an agent move
   *  a customer who's reachable on several channels between them. */
  @Post(":id/reach")
  async reach(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reachInputSchema)) body: ReachInput,
  ): Promise<{ conversationId: string; created: boolean }> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    const contact = await this.store.getContactWithConversations(id);
    if (!contact) throw new NotFoundException("Customer not found");

    if (body.channel === "whatsapp" && !contact.phone) {
      throw new BadRequestException("This customer has no WhatsApp number on file.");
    }
    if (body.channel === "email" && !contact.email) {
      throw new BadRequestException("This customer has no email address on file.");
    }

    const inbox = (await this.store.listInboxes()).find((i) => i.type === body.channel);
    if (!inbox) {
      throw new BadRequestException(`No ${body.channel} inbox is connected yet.`);
    }

    const { conversation, created } = await this.store.findOrCreateOpenConversation({
      orgId: me.orgId,
      inboxId: inbox.id,
      contact,
      channel: body.channel,
      // The agent starting the outreach owns the new thread.
      assigneeUserId: me.id,
    });
    if (created) this.realtime.emitConversationUpdated(conversation);
    return { conversationId: conversation.id, created };
  }
}
