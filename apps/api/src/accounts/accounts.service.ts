import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  accountNameKey,
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
  type AccountStatus,
  type Actor,
  type ContactAccount,
  type ConversationAccountContext,
  type User,
} from "@ding/schemas";
import { Store } from "../data/store";
import { AccountStore, type AccountCounts, type AccountFields, type AccountRow, type LinkRow, type ResourceRow } from "./account.store";
import { knowledgeText, sanitizeKnowledgeHtml } from "./knowledge-html";

/** Parsed inputs (zod output types, see @ding/schemas accounts.ts). */
export interface AccountInputParsed {
  name?: string;
  legalName?: string | null;
  reference?: string | null;
  summary?: string;
  overview?: string;
  status?: AccountStatus;
  tags?: string[];
  ownerUserId?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
}

/**
 * Organisations and their knowledge.
 *
 * Who may do what (the workspace's roles, nothing new):
 *   - everyone in the workspace reads all of it — a new starter has to;
 *   - everyone can create organisations and write knowledge — the people who
 *     know how a customer is served are usually the ones doing it, and every
 *     change is attributed, logged and (for SOPs) versioned;
 *   - managers and admins archive and restore organisations and SOPs, and can
 *     delete anyone's alert, note or resource; others delete only their own.
 * An archived organisation is read-only until it's restored. Nothing here ever
 * deletes a contact or a conversation.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly accounts: AccountStore,
    private readonly store: Store,
  ) {}

  /* ------------------------------ people ------------------------------ */

  async actor(userId: string): Promise<{ user: User; actor: Actor }> {
    const user = await this.store.getUser(userId);
    if (!user) throw new ForbiddenException("Not signed in");
    return { user, actor: { id: user.id, name: user.name } };
  }

  private isManager(user: User): boolean {
    return user.role === "admin" || user.role === "manager";
  }

  private requireManager(user: User, what: string): void {
    if (!this.isManager(user)) throw new ForbiddenException(`Only a manager or admin can ${what}`);
  }

  /** The author or a manager. */
  private requireOwnerOrManager(user: User, by: Actor | null, what: string): void {
    if (this.isManager(user) || (by?.id && by.id === user.id)) return;
    throw new ForbiddenException(`Only whoever added it, or a manager, can ${what}`);
  }

  private async ownerName(ownerUserId: string | null, cache = new Map<string, string | null>()): Promise<string | null> {
    if (!ownerUserId) return null;
    if (!cache.has(ownerUserId)) cache.set(ownerUserId, (await this.store.getUser(ownerUserId))?.name ?? null);
    return cache.get(ownerUserId) ?? null;
  }

  /* ---------------------------- organisations ---------------------------- */

  private async toAccount(row: AccountRow, cache?: Map<string, string | null>): Promise<Account> {
    const { orgId: _org, nameKey: _key, ...rest } = row;
    return { ...rest, ownerName: await this.ownerName(row.ownerUserId, cache) };
  }

  private async toListItem(row: AccountRow & AccountCounts, cache: Map<string, string | null>): Promise<AccountListItem> {
    return {
      id: row.id,
      name: row.name,
      legalName: row.legalName,
      reference: row.reference,
      summary: row.summary,
      status: row.status,
      tags: row.tags,
      ownerUserId: row.ownerUserId,
      ownerName: await this.ownerName(row.ownerUserId, cache),
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
      contactCount: row.contactCount,
      alertCount: row.alertCount,
      sopCount: row.sopCount,
    };
  }

  async list(query: { search?: string; status?: AccountStatus; includeArchived?: boolean }): Promise<AccountListItem[]> {
    const cache = new Map<string, string | null>();
    const rows = await this.accounts.list(query);
    return Promise.all(rows.map((r) => this.toListItem(r, cache)));
  }

  private async mustGet(id: string): Promise<AccountRow> {
    const row = await this.accounts.get(id);
    if (!row) throw new NotFoundException("Organisation not found");
    return row;
  }

  /** For a change: it must exist and not be archived. */
  private async mustEdit(id: string): Promise<AccountRow> {
    const row = await this.mustGet(id);
    if (row.archivedAt) throw new BadRequestException("This organisation is archived — restore it to make changes");
    return row;
  }

  async detail(id: string): Promise<AccountDetail> {
    const row = await this.mustGet(id);
    const [contacts, alerts, sops, notes, resources] = await Promise.all([
      this.contactsOf(id),
      this.accounts.listAlerts(id),
      this.accounts.listSops(id),
      this.accounts.listNotes(id),
      this.resourcesOf(id),
    ]);
    return { account: await this.toAccount(row), contacts, alerts, sops, notes, resources };
  }

  private async validOwner(ownerUserId: string | null | undefined): Promise<void> {
    if (!ownerUserId) return;
    if (!(await this.store.getUser(ownerUserId))) throw new BadRequestException("That account owner isn't in this workspace");
  }

  async create(
    userId: string,
    input: AccountInputParsed & { name: string; force?: boolean; contactId?: string },
  ): Promise<Account> {
    const { actor } = await this.actor(userId);
    await this.validOwner(input.ownerUserId);
    const nameKey = accountNameKey(input.name) || input.name.toLowerCase();
    if (!input.force) {
      const similar = await this.accounts.findSimilar(nameKey, input.reference ?? null);
      if (similar.length) {
        const s = similar[0]!;
        throw new ConflictException({
          message: s.archivedAt
            ? `“${s.name}” already exists (archived) — restore it rather than starting again`
            : `“${s.name}” already exists`,
          details: { existing: { id: s.id, name: s.name, archived: !!s.archivedAt } },
        });
      }
    }
    if (input.contactId && !(await this.store.getContact(input.contactId))) throw new NotFoundException("Contact not found");
    const fields: AccountFields = {
      name: input.name,
      nameKey,
      legalName: input.legalName ?? null,
      reference: input.reference ?? null,
      summary: input.summary ?? "",
      overview: input.overview ?? "",
      status: input.status ?? "active",
      tags: normaliseTags(input.tags ?? []),
      ownerUserId: input.ownerUserId ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      address: input.address ?? null,
    };
    const row = await this.accounts.create(fields, actor);
    await this.accounts.logActivity(row.id, actor, "account.created", `Created ${row.name}`);
    if (input.contactId) await this.link(userId, row.id, { contactId: input.contactId, isPrimary: true });
    return this.toAccount(row);
  }

  async update(userId: string, id: string, input: AccountInputParsed): Promise<Account> {
    const { actor } = await this.actor(userId);
    const before = await this.mustEdit(id);
    await this.validOwner(input.ownerUserId);
    const patch: Partial<AccountFields> = {};
    for (const key of ["legalName", "reference", "summary", "overview", "status", "ownerUserId", "phone", "email", "website", "address"] as const) {
      if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key];
    }
    if (input.tags !== undefined) patch.tags = normaliseTags(input.tags);
    if (input.name !== undefined && input.name !== before.name) {
      const nameKey = accountNameKey(input.name) || input.name.toLowerCase();
      const clash = (await this.accounts.findSimilar(nameKey, null)).find((a) => a.id !== id);
      if (clash) throw new ConflictException({ message: `“${clash.name}” already exists`, details: { existing: { id: clash.id, name: clash.name, archived: !!clash.archivedAt } } });
      patch.name = input.name;
      patch.nameKey = nameKey;
    }
    const changed = (Object.keys(patch) as Array<keyof AccountFields>).filter(
      (k) => k !== "nameKey" && JSON.stringify(patch[k]) !== JSON.stringify(before[k]),
    );
    const row = (await this.accounts.update(id, patch, actor))!;
    if (changed.length) {
      await this.accounts.logActivity(id, actor, "account.updated", `Updated ${changed.map(fieldLabel).join(", ")}`);
    }
    return this.toAccount(row);
  }

  async setArchived(userId: string, id: string, archived: boolean): Promise<Account> {
    const { user, actor } = await this.actor(userId);
    this.requireManager(user, archived ? "archive an organisation" : "restore an organisation");
    await this.mustGet(id);
    const row = (await this.accounts.setArchived(id, archived, actor))!;
    await this.accounts.logActivity(id, actor, archived ? "account.archived" : "account.restored", archived ? "Archived the organisation" : "Restored the organisation");
    return this.toAccount(row);
  }

  async activity(id: string): Promise<AccountActivity[]> {
    await this.mustGet(id);
    return this.accounts.listActivity(id, 200);
  }

  /* ------------------------------ contacts ------------------------------ */

  private async withContact(link: LinkRow): Promise<AccountContact | null> {
    const c = await this.store.getContact(link.contactId);
    if (!c) return null;
    return {
      ...link,
      contact: {
        id: c.id,
        displayName: c.displayName,
        phone: c.phone,
        email: c.email,
        avatarColor: c.avatarColor,
        blocked: c.blocked,
      },
    };
  }

  private async contactsOf(accountId: string): Promise<AccountContact[]> {
    const links = await this.accounts.listLinks(accountId);
    return (await Promise.all(links.map((l) => this.withContact(l)))).filter((x): x is AccountContact => !!x);
  }

  async link(
    userId: string,
    accountId: string,
    input: { contactId: string; role?: string | null; department?: string | null; isPrimary?: boolean; notes?: string | null },
  ): Promise<AccountContact> {
    const { actor } = await this.actor(userId);
    const account = await this.mustEdit(accountId);
    const contact = await this.store.getContact(input.contactId);
    if (!contact) throw new NotFoundException("Contact not found");
    const existing = (await this.accounts.listLinks(accountId)).find((l) => l.contactId === input.contactId);
    const link = await this.accounts.link(accountId, input.contactId, {
      role: input.role ?? existing?.role ?? null,
      department: input.department ?? existing?.department ?? null,
      isPrimary: input.isPrimary ?? existing?.isPrimary ?? false,
      notes: input.notes ?? existing?.notes ?? null,
    });
    if (link.isPrimary) await this.onlyPrimary(accountId, input.contactId);
    if (!existing) {
      await this.accounts.logActivity(
        accountId,
        actor,
        "contact.linked",
        `Linked ${contact.displayName}${link.role ? ` (${link.role})` : ""} to ${account.name}`,
      );
    }
    return (await this.withContact(link))!;
  }

  /** One primary contact per organisation. */
  private async onlyPrimary(accountId: string, contactId: string): Promise<void> {
    for (const l of await this.accounts.listLinks(accountId)) {
      if (l.contactId !== contactId && l.isPrimary) await this.accounts.updateLink(accountId, l.contactId, { isPrimary: false });
    }
  }

  async updateLink(
    userId: string,
    accountId: string,
    contactId: string,
    patch: { role?: string | null; department?: string | null; isPrimary?: boolean; notes?: string | null },
  ): Promise<AccountContact> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const link = await this.accounts.updateLink(accountId, contactId, clean);
    if (!link) throw new NotFoundException("That contact isn't linked to this organisation");
    if (link.isPrimary) await this.onlyPrimary(accountId, contactId);
    const contact = await this.withContact(link);
    await this.accounts.logActivity(accountId, actor, "contact.updated", `Updated ${contact?.contact.displayName ?? "a contact"}'s role`);
    return contact!;
  }

  async unlink(userId: string, accountId: string, contactId: string): Promise<void> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const contact = await this.store.getContact(contactId);
    if (!(await this.accounts.unlink(accountId, contactId))) throw new NotFoundException("That contact isn't linked to this organisation");
    // The contact and their conversations stay exactly as they were.
    await this.accounts.logActivity(accountId, actor, "contact.unlinked", `Removed ${contact?.displayName ?? "a contact"} from the organisation`);
  }

  /** A contact's organisations (archived ones left out). */
  async forContact(contactId: string): Promise<ContactAccount[]> {
    if (!(await this.store.getContact(contactId))) throw new NotFoundException("Contact not found");
    const cache = new Map<string, string | null>();
    const out: ContactAccount[] = [];
    for (const link of await this.accounts.linksForContact(contactId)) {
      const row = await this.accounts.get(link.accountId);
      if (!row || row.archivedAt) continue;
      out.push({ account: await this.toListItem({ ...row, ...(await this.accounts.counts(row.id)) }, cache), link });
    }
    return out.sort((a, b) => a.account.name.localeCompare(b.account.name));
  }

  /* ------------------------------- alerts ------------------------------- */

  async createAlert(userId: string, accountId: string, input: { body: string; priority: AccountAlert["priority"] }): Promise<AccountAlert> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const alert = await this.accounts.createAlert(accountId, input, actor);
    await this.accounts.logActivity(accountId, actor, "alert.created", `Added ${input.priority} alert: “${clip(input.body)}”`);
    return alert;
  }

  async updateAlert(userId: string, accountId: string, id: string, patch: { body?: string; priority?: AccountAlert["priority"] }): Promise<AccountAlert> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const before = await this.accounts.getAlert(accountId, id);
    if (!before) throw new NotFoundException("Alert not found");
    const alert = (await this.accounts.updateAlert(accountId, id, patch, actor))!;
    await this.accounts.logActivity(accountId, actor, "alert.updated", `Changed alert: “${clip(before.body)}” → “${clip(alert.body)}” (${alert.priority})`);
    return alert;
  }

  async deleteAlert(userId: string, accountId: string, id: string): Promise<void> {
    const { user, actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const alert = await this.accounts.getAlert(accountId, id);
    if (!alert) throw new NotFoundException("Alert not found");
    this.requireOwnerOrManager(user, alert.createdBy, "remove this alert");
    await this.accounts.deleteAlert(accountId, id);
    await this.accounts.logActivity(accountId, actor, "alert.deleted", `Removed alert: “${clip(alert.body)}”`);
  }

  /* -------------------------------- SOPs -------------------------------- */

  async createSop(
    userId: string,
    accountId: string,
    input: { title: string; category: string; summary: string; warnings: string; steps: { text: string }[]; body: string; status: AccountSop["status"] },
  ): Promise<AccountSop> {
    const { user, actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    if (input.status === "archived") this.requireManager(user, "archive an SOP");
    const sop = await this.accounts.createSop(
      accountId,
      { ...input, category: input.category || "General", body: sanitizeKnowledgeHtml(input.body) },
      actor,
    );
    await this.accounts.logActivity(accountId, actor, "sop.created", `Added SOP “${sop.title}”${sop.status === "draft" ? " (draft)" : ""}`);
    return sop;
  }

  async updateSop(
    userId: string,
    accountId: string,
    id: string,
    patch: Partial<{ title: string; category: string; summary: string; warnings: string; steps: { text: string }[]; body: string; status: AccountSop["status"] }>,
  ): Promise<AccountSop> {
    const { user, actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const before = await this.accounts.getSop(accountId, id);
    if (!before) throw new NotFoundException("SOP not found");
    const archiving = patch.status === "archived" && before.status !== "archived";
    const restoring = before.status === "archived" && patch.status !== undefined && patch.status !== "archived";
    if (archiving || restoring) this.requireManager(user, archiving ? "archive an SOP" : "restore an archived SOP");
    const clean: typeof patch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (clean.body !== undefined) clean.body = sanitizeKnowledgeHtml(clean.body);
    if (clean.category !== undefined && !clean.category) clean.category = "General";
    const sop = (await this.accounts.updateSop(accountId, id, clean, actor))!;
    const what = archiving ? "Archived" : restoring ? "Restored" : before.status === "draft" && sop.status === "active" ? "Published" : "Updated";
    await this.accounts.logActivity(accountId, actor, `sop.${what.toLowerCase()}`, `${what} SOP “${sop.title}” (v${sop.version})`);
    return sop;
  }

  async sopRevisions(accountId: string, id: string): Promise<AccountSopRevision[]> {
    await this.mustGet(accountId);
    if (!(await this.accounts.getSop(accountId, id))) throw new NotFoundException("SOP not found");
    return this.accounts.listSopRevisions(accountId, id);
  }

  /* -------------------------------- notes -------------------------------- */

  async createNote(userId: string, accountId: string, input: { title: string; body: string; category: string }): Promise<AccountNote> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const body = sanitizeKnowledgeHtml(input.body);
    if (!knowledgeText(body)) throw new BadRequestException("The note is empty");
    const note = await this.accounts.createNote(accountId, { ...input, category: input.category || "General", body }, actor);
    await this.accounts.logActivity(accountId, actor, "note.created", `Added note${note.title ? ` “${note.title}”` : ""}`);
    return note;
  }

  async updateNote(userId: string, accountId: string, id: string, patch: { title?: string; body?: string; category?: string }): Promise<AccountNote> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    if (!(await this.accounts.getNote(accountId, id))) throw new NotFoundException("Note not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as typeof patch;
    if (clean.body !== undefined) {
      clean.body = sanitizeKnowledgeHtml(clean.body);
      if (!knowledgeText(clean.body)) throw new BadRequestException("The note is empty");
    }
    const note = (await this.accounts.updateNote(accountId, id, clean, actor))!;
    await this.accounts.logActivity(accountId, actor, "note.updated", `Updated note${note.title ? ` “${note.title}”` : ""}`);
    return note;
  }

  async deleteNote(userId: string, accountId: string, id: string): Promise<void> {
    const { user, actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const note = await this.accounts.getNote(accountId, id);
    if (!note) throw new NotFoundException("Note not found");
    this.requireOwnerOrManager(user, note.createdBy, "delete this note");
    await this.accounts.deleteNote(accountId, id);
    await this.accounts.logActivity(accountId, actor, "note.deleted", `Deleted note${note.title ? ` “${note.title}”` : ""}`);
  }

  /* ------------------------------ resources ------------------------------ */

  private async withFile(r: ResourceRow): Promise<AccountResource> {
    const file = r.attachmentId ? await this.store.getAttachment(r.attachmentId) : undefined;
    return {
      ...r,
      fileName: file?.filename ?? null,
      fileMime: file?.mime ?? null,
      fileSize: null,
    };
  }

  private async resourcesOf(accountId: string): Promise<AccountResource[]> {
    return Promise.all((await this.accounts.listResources(accountId)).map((r) => this.withFile(r)));
  }

  private async validSop(accountId: string, sopId: string | null | undefined): Promise<void> {
    if (sopId && !(await this.accounts.getSop(accountId, sopId))) throw new BadRequestException("That SOP isn't on this organisation");
  }

  async createResource(
    userId: string,
    accountId: string,
    input: {
      kind: AccountResource["kind"];
      title: string;
      description: string;
      category: string;
      url?: string | null;
      instructions: string;
      attachmentId?: string | null;
      sopId?: string | null;
    },
  ): Promise<AccountResource> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    await this.validSop(accountId, input.sopId);
    // The upload must be this workspace's (the store's lookup is tenant-scoped).
    if (input.kind === "file" && !(input.attachmentId && (await this.store.getAttachment(input.attachmentId)))) {
      throw new BadRequestException("Upload the file first");
    }
    const row = await this.accounts.createResource(
      accountId,
      {
        kind: input.kind,
        title: input.title,
        description: input.description,
        category: input.category || "General",
        url: input.kind === "file" ? null : (input.url ?? null),
        instructions: input.instructions,
        attachmentId: input.kind === "file" ? (input.attachmentId ?? null) : null,
        sopId: input.sopId ?? null,
      },
      actor,
    );
    await this.accounts.logActivity(accountId, actor, "resource.created", `Added ${kindLabel(row.kind)} “${row.title}”`);
    return this.withFile(row);
  }

  async updateResource(
    userId: string,
    accountId: string,
    id: string,
    patch: { title?: string; description?: string; category?: string; url?: string | null; instructions?: string; sopId?: string | null },
  ): Promise<AccountResource> {
    const { actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const before = await this.accounts.getResource(accountId, id);
    if (!before) throw new NotFoundException("Resource not found");
    await this.validSop(accountId, patch.sopId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as typeof patch;
    if (before.kind === "file") delete clean.url;
    else if (clean.url === null) throw new BadRequestException("A link needs its web address");
    const row = (await this.accounts.updateResource(accountId, id, clean))!;
    await this.accounts.logActivity(accountId, actor, "resource.updated", `Updated ${kindLabel(row.kind)} “${row.title}”`);
    return this.withFile(row);
  }

  async deleteResource(userId: string, accountId: string, id: string): Promise<void> {
    const { user, actor } = await this.actor(userId);
    await this.mustEdit(accountId);
    const r = await this.accounts.getResource(accountId, id);
    if (!r) throw new NotFoundException("Resource not found");
    this.requireOwnerOrManager(user, r.createdBy, "remove this resource");
    await this.accounts.deleteResource(accountId, id);
    await this.accounts.logActivity(accountId, actor, "resource.deleted", `Removed ${kindLabel(r.kind)} “${r.title}”`);
  }

  /* ------------------------------- inbox ------------------------------- */

  /**
   * What the inbox shows beside a conversation. An organisation chosen for the
   * conversation wins; otherwise the contact's only one; with several and none
   * chosen, nothing is shown until someone picks — never a guess.
   */
  async conversationContext(conversationId: string): Promise<ConversationAccountContext> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv) throw new NotFoundException("Conversation not found");
    const contactId = conv.contact.id;
    const linked = await this.forContact(contactId);
    const selectedAccountId = await this.accounts.getConversationAccount(conversationId);
    const selected = selectedAccountId ? await this.accounts.get(selectedAccountId) : undefined;
    let chosen: AccountRow | undefined;
    let basis: ConversationAccountContext["basis"] = null;
    if (selected) {
      chosen = selected;
      basis = "chosen";
    } else if (linked.length === 1) {
      chosen = await this.accounts.get(linked[0]!.account.id);
      basis = "only";
    }
    let account: ConversationAccountContext["account"] = null;
    if (chosen) {
      const [alerts, sops, resources, notes, counts] = await Promise.all([
        this.accounts.listAlerts(chosen.id),
        this.accounts.listSops(chosen.id),
        this.resourcesOf(chosen.id),
        this.accounts.listNotes(chosen.id),
        this.accounts.counts(chosen.id),
      ]);
      account = {
        account: await this.toAccount(chosen),
        alerts,
        // Only what's in force is presented as how things are done.
        sops: sops.filter((s) => s.status === "active"),
        resources,
        noteCount: notes.length,
        contactCount: counts.contactCount,
        link: linked.find((l) => l.account.id === chosen!.id)?.link ?? null,
      };
    }
    return {
      conversationId,
      contactId,
      linked,
      selectedAccountId: selected ? selected.id : null,
      basis,
      needsChoice: !chosen && linked.length > 1,
      account,
    };
  }

  /** Say which organisation a conversation is about (or clear it). */
  async setConversationAccount(userId: string, conversationId: string, accountId: string | null): Promise<ConversationAccountContext> {
    const { actor } = await this.actor(userId);
    const conv = await this.store.getConversation(conversationId);
    if (!conv) throw new NotFoundException("Conversation not found");
    if (accountId) {
      const account = await this.mustGet(accountId);
      if (account.archivedAt) throw new BadRequestException("That organisation is archived");
      await this.accounts.setConversationAccount(conversationId, accountId);
      await this.accounts.logActivity(accountId, actor, "conversation.linked", `Marked a conversation with ${conv.contact.displayName} as about ${account.name}`);
    } else {
      await this.accounts.setConversationAccount(conversationId, null);
    }
    return this.conversationContext(conversationId);
  }
}

function normaliseTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function clip(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function kindLabel(kind: string): string {
  return kind === "file" ? "document" : kind === "app" ? "app" : "link";
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    name: "name",
    legalName: "legal name",
    reference: "account reference",
    summary: "summary",
    overview: "overview",
    status: "status",
    tags: "tags",
    ownerUserId: "account owner",
    phone: "phone",
    email: "email",
    website: "website",
    address: "address",
  };
  return labels[key] ?? key;
}
