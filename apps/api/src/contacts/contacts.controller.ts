import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createContactInputSchema,
  mergeContactsInputSchema,
  reachInputSchema,
  updateContactInputSchema,
  type CreateContactInput,
  type MergeContactsInput,
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

  /** Possible-duplicate clusters — contacts that share a normalised phone or
   *  email. Declared before `:id` so the literal path isn't read as an id. */
  @Get("duplicates")
  duplicates() {
    return this.store.findDuplicateContacts();
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
    // Get-or-create: `existed` is true when the phone/email already matched a
    // contact, so the UI can open that one instead of adding a duplicate.
    const { contact, created } = await this.store.createContact({ orgId: me.orgId, ...body });
    return { contact, existed: !created };
  }

  /** Merge duplicate customers into one surviving record (winnerId). The losers'
   *  identities, conversations and blank fields fold into the winner, then the
   *  losers are deleted. */
  @Post("merge")
  async merge(@Body(new ZodValidationPipe(mergeContactsInputSchema)) body: MergeContactsInput) {
    if (body.loserIds.includes(body.winnerId)) {
      throw new BadRequestException("A customer can't be merged into itself.");
    }
    const contact = await this.store.mergeContacts(body);
    return { contact };
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

  /** Permanently delete a customer and everything attached to them. */
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ ok: boolean }> {
    await this.store.deleteContact(id);
    return { ok: true };
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

    const inboxes = await this.store.listInboxes();
    // Honour an explicit inbox (the composer's "send from" choice when several of
    // the same channel are connected); otherwise fall back to the first.
    const inbox = body.inboxId
      ? inboxes.find((i) => i.id === body.inboxId && i.type === body.channel)
      : inboxes.find((i) => i.type === body.channel);
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
