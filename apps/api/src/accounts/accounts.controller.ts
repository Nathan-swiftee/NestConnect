import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  accountStatusSchema,
  alertInputSchema,
  createAccountInputSchema,
  linkContactInputSchema,
  linkContactsInputSchema,
  noteInputSchema,
  resourceInputSchema,
  setConversationAccountInputSchema,
  sopInputSchema,
  updateAccountInputSchema,
  updateAlertInputSchema,
  updateContactLinkInputSchema,
  updateNoteInputSchema,
  updateResourceInputSchema,
  updateSopInputSchema,
  type Account,
  type AccountActivity,
  type AccountAlert,
  type AccountContact,
  type AccountDetail,
  type AccountListItem,
  type AccountNote,
  type AccountResource,
  type AccountSop,
  type AccountSopRevision,
  type ContactAccount,
  type ConversationAccountContext,
} from "@ding/schemas";
import { z } from "zod";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AccountsService } from "./accounts.service";

/**
 * Organisations (customer accounts) and their knowledge. Every route acts in
 * the signed-in user's workspace; who may change what is decided in the
 * service (see AccountsService).
 */
@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("archived") archived?: string,
  ): Promise<AccountListItem[]> {
    const parsedStatus = accountStatusSchema.safeParse(status);
    return this.accounts.list({
      search: q?.slice(0, 200),
      status: parsedStatus.success ? parsedStatus.data : undefined,
      includeArchived: archived === "1" || archived === "true",
    });
  }

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createAccountInputSchema)) body: z.output<typeof createAccountInputSchema>,
  ): Promise<Account> {
    return this.accounts.create(userId, body);
  }

  /* Declared before ":id" so they aren't read as an organisation id. */

  @Get("by-contact/:contactId")
  forContact(@Param("contactId") contactId: string): Promise<ContactAccount[]> {
    return this.accounts.forContact(contactId);
  }

  @Get("conversation/:conversationId")
  conversationContext(@Param("conversationId") conversationId: string): Promise<ConversationAccountContext> {
    return this.accounts.conversationContext(conversationId);
  }

  @Put("conversation/:conversationId")
  setConversationAccount(
    @CurrentUserId() userId: string,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(setConversationAccountInputSchema)) body: { accountId: string | null },
  ): Promise<ConversationAccountContext> {
    return this.accounts.setConversationAccount(userId, conversationId, body.accountId);
  }

  @Get(":id")
  detail(@Param("id") id: string): Promise<AccountDetail> {
    return this.accounts.detail(id);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAccountInputSchema)) body: z.output<typeof updateAccountInputSchema>,
  ): Promise<Account> {
    return this.accounts.update(userId, id, body);
  }

  @Post(":id/archive")
  @HttpCode(200)
  archive(@CurrentUserId() userId: string, @Param("id") id: string): Promise<Account> {
    return this.accounts.setArchived(userId, id, true);
  }

  @Post(":id/restore")
  @HttpCode(200)
  restore(@CurrentUserId() userId: string, @Param("id") id: string): Promise<Account> {
    return this.accounts.setArchived(userId, id, false);
  }

  @Delete(":id")
  async remove(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.accounts.remove(userId, id);
    return { ok: true };
  }

  @Get(":id/activity")
  activity(@Param("id") id: string): Promise<AccountActivity[]> {
    return this.accounts.activity(id);
  }

  /* contacts */

  @Post(":id/contacts")
  link(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(linkContactInputSchema)) body: z.output<typeof linkContactInputSchema>,
  ): Promise<AccountContact> {
    return this.accounts.link(userId, id, body);
  }

  @Post(":id/contacts/many")
  linkMany(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(linkContactsInputSchema)) body: { contactIds: string[] },
  ): Promise<AccountContact[]> {
    return this.accounts.linkMany(userId, id, body.contactIds);
  }

  @Patch(":id/contacts/:contactId")
  updateLink(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(updateContactLinkInputSchema)) body: z.output<typeof updateContactLinkInputSchema>,
  ): Promise<AccountContact> {
    return this.accounts.updateLink(userId, id, contactId, body);
  }

  @Delete(":id/contacts/:contactId")
  unlink(@CurrentUserId() userId: string, @Param("id") id: string, @Param("contactId") contactId: string): Promise<{ ok: true }> {
    return this.accounts.unlink(userId, id, contactId).then(() => ({ ok: true as const }));
  }

  /* alerts */

  @Post(":id/alerts")
  createAlert(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(alertInputSchema)) body: z.output<typeof alertInputSchema>,
  ): Promise<AccountAlert> {
    return this.accounts.createAlert(userId, id, body);
  }

  @Patch(":id/alerts/:alertId")
  updateAlert(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Param("alertId") alertId: string,
    @Body(new ZodValidationPipe(updateAlertInputSchema)) body: z.output<typeof updateAlertInputSchema>,
  ): Promise<AccountAlert> {
    return this.accounts.updateAlert(userId, id, alertId, body);
  }

  @Delete(":id/alerts/:alertId")
  deleteAlert(@CurrentUserId() userId: string, @Param("id") id: string, @Param("alertId") alertId: string): Promise<{ ok: true }> {
    return this.accounts.deleteAlert(userId, id, alertId).then(() => ({ ok: true as const }));
  }

  /* SOPs */

  @Post(":id/sops")
  createSop(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sopInputSchema)) body: z.output<typeof sopInputSchema>,
  ): Promise<AccountSop> {
    return this.accounts.createSop(userId, id, body);
  }

  @Patch(":id/sops/:sopId")
  updateSop(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Param("sopId") sopId: string,
    @Body(new ZodValidationPipe(updateSopInputSchema)) body: z.output<typeof updateSopInputSchema>,
  ): Promise<AccountSop> {
    return this.accounts.updateSop(userId, id, sopId, body);
  }

  @Get(":id/sops/:sopId/revisions")
  sopRevisions(@Param("id") id: string, @Param("sopId") sopId: string): Promise<AccountSopRevision[]> {
    return this.accounts.sopRevisions(id, sopId);
  }

  /* notes */

  @Post(":id/notes")
  createNote(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(noteInputSchema)) body: z.output<typeof noteInputSchema>,
  ): Promise<AccountNote> {
    return this.accounts.createNote(userId, id, body);
  }

  @Patch(":id/notes/:noteId")
  updateNote(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(updateNoteInputSchema)) body: z.output<typeof updateNoteInputSchema>,
  ): Promise<AccountNote> {
    return this.accounts.updateNote(userId, id, noteId, body);
  }

  @Delete(":id/notes/:noteId")
  deleteNote(@CurrentUserId() userId: string, @Param("id") id: string, @Param("noteId") noteId: string): Promise<{ ok: true }> {
    return this.accounts.deleteNote(userId, id, noteId).then(() => ({ ok: true as const }));
  }

  /* resources */

  @Post(":id/resources")
  createResource(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resourceInputSchema)) body: z.output<typeof resourceInputSchema>,
  ): Promise<AccountResource> {
    return this.accounts.createResource(userId, id, body);
  }

  @Patch(":id/resources/:resourceId")
  updateResource(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Param("resourceId") resourceId: string,
    @Body(new ZodValidationPipe(updateResourceInputSchema)) body: z.output<typeof updateResourceInputSchema>,
  ): Promise<AccountResource> {
    return this.accounts.updateResource(userId, id, resourceId, body);
  }

  @Delete(":id/resources/:resourceId")
  deleteResource(@CurrentUserId() userId: string, @Param("id") id: string, @Param("resourceId") resourceId: string): Promise<{ ok: true }> {
    return this.accounts.deleteResource(userId, id, resourceId).then(() => ({ ok: true as const }));
  }
}
