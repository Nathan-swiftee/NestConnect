import { Injectable } from "@nestjs/common";
import type {
  AccountActivity,
  AccountAlert,
  AccountNote,
  AccountSop,
  AccountSopRevision,
  Actor,
  AlertPriority,
} from "@ding/schemas";
import { boundOrgId } from "../tenancy/tenant-scope";
import {
  AccountStore,
  type AccountCounts,
  type AccountFields,
  type AccountRow,
  type LinkRow,
  type ListAccountsQuery,
  type ResourceRow,
  type SopFields,
} from "./account.store";

const PRIORITY_ORDER: Record<string, number> = { critical: 0, important: 1, info: 2 };
const now = () => new Date().toISOString();

/**
 * The in-memory account store, for dev and the checks. Like the core
 * MemoryStore it holds one workspace's data; rows still carry their orgId and
 * reads filter on the bound one, so a check can't pass here and fail in
 * Postgres for want of scoping.
 */
@Injectable()
export class MemoryAccountStore extends AccountStore {
  private seq = 0;
  private accounts: AccountRow[] = [];
  private links: LinkRow[] = [];
  private alerts: AccountAlert[] = [];
  private sops: AccountSop[] = [];
  private revisions: AccountSopRevision[] = [];
  private notes: AccountNote[] = [];
  private resources: ResourceRow[] = [];
  private activity: AccountActivity[] = [];
  private conversationAccount = new Map<string, string | null>();

  private id(prefix: string): string {
    return `${prefix}_${++this.seq}`;
  }
  private mine(a: AccountRow): boolean {
    const org = boundOrgId();
    return !org || a.orgId === org;
  }
  private owned(accountId: string): boolean {
    const a = this.accounts.find((x) => x.id === accountId);
    return !!a && this.mine(a);
  }

  async list(query: ListAccountsQuery): Promise<Array<AccountRow & AccountCounts>> {
    const q = query.search?.trim().toLowerCase();
    const rows = this.accounts
      .filter((a) => this.mine(a))
      .filter((a) => query.includeArchived || !a.archivedAt)
      .filter((a) => !query.status || a.status === query.status)
      .filter(
        (a) =>
          !q ||
          [a.name, a.legalName, a.reference, a.summary].some((v) => (v ?? "").toLowerCase().includes(q)) ||
          a.tags.includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return Promise.all(rows.map(async (a) => ({ ...a, ...(await this.counts(a.id)) })));
  }

  async get(id: string): Promise<AccountRow | undefined> {
    const a = this.accounts.find((x) => x.id === id);
    return a && this.mine(a) ? { ...a } : undefined;
  }

  async counts(id: string): Promise<AccountCounts> {
    return {
      contactCount: this.links.filter((l) => l.accountId === id).length,
      alertCount: this.alerts.filter((l) => l.accountId === id).length,
      sopCount: this.sops.filter((s) => s.accountId === id && s.status === "active").length,
    };
  }

  async findSimilar(nameKey: string, reference: string | null): Promise<AccountRow[]> {
    return this.accounts.filter(
      (a) =>
        this.mine(a) &&
        (a.nameKey === nameKey || (!!reference && (a.reference ?? "").toLowerCase() === reference.toLowerCase())),
    );
  }

  async create(fields: AccountFields, by: Actor): Promise<AccountRow> {
    const t = now();
    const row: AccountRow = {
      ...fields,
      id: this.id("acct"),
      orgId: boundOrgId() ?? "org_swiftee",
      archivedAt: null,
      createdAt: t,
      updatedAt: t,
      createdBy: by,
      updatedBy: by,
    };
    this.accounts.push(row);
    return { ...row };
  }

  async update(id: string, patch: Partial<AccountFields>, by: Actor): Promise<AccountRow | undefined> {
    const a = this.accounts.find((x) => x.id === id);
    if (!a || !this.mine(a)) return undefined;
    Object.assign(a, patch, { updatedAt: now(), updatedBy: by });
    return { ...a };
  }

  async setArchived(id: string, archived: boolean, by: Actor): Promise<AccountRow | undefined> {
    const a = this.accounts.find((x) => x.id === id);
    if (!a || !this.mine(a)) return undefined;
    Object.assign(a, { archivedAt: archived ? now() : null, updatedAt: now(), updatedBy: by });
    return { ...a };
  }

  async listLinks(accountId: string): Promise<LinkRow[]> {
    if (!this.owned(accountId)) return [];
    return this.links
      .filter((l) => l.accountId === accountId)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.localeCompare(b.createdAt));
  }

  async linksForContact(contactId: string): Promise<LinkRow[]> {
    return this.links.filter((l) => l.contactId === contactId && this.owned(l.accountId));
  }

  async link(accountId: string, contactId: string, details: Omit<LinkRow, "accountId" | "contactId" | "createdAt">): Promise<LinkRow> {
    const existing = this.links.find((l) => l.accountId === accountId && l.contactId === contactId);
    if (existing) {
      Object.assign(existing, details);
      return { ...existing };
    }
    const row: LinkRow = { accountId, contactId, ...details, createdAt: now() };
    this.links.push(row);
    return { ...row };
  }

  async updateLink(accountId: string, contactId: string, patch: Partial<Omit<LinkRow, "accountId" | "contactId" | "createdAt">>): Promise<LinkRow | undefined> {
    const l = this.links.find((x) => x.accountId === accountId && x.contactId === contactId);
    if (!l || !this.owned(accountId)) return undefined;
    Object.assign(l, patch);
    return { ...l };
  }

  async unlink(accountId: string, contactId: string): Promise<boolean> {
    const before = this.links.length;
    this.links = this.links.filter((l) => !(l.accountId === accountId && l.contactId === contactId && this.owned(accountId)));
    return this.links.length < before;
  }

  async listAlerts(accountId: string): Promise<AccountAlert[]> {
    if (!this.owned(accountId)) return [];
    return this.alerts
      .filter((a) => a.accountId === accountId)
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || a.createdAt.localeCompare(b.createdAt));
  }

  async getAlert(accountId: string, id: string): Promise<AccountAlert | undefined> {
    return this.owned(accountId) ? this.alerts.find((a) => a.id === id && a.accountId === accountId) : undefined;
  }

  async createAlert(accountId: string, input: { body: string; priority: AlertPriority }, by: Actor): Promise<AccountAlert> {
    const t = now();
    const row: AccountAlert = { id: this.id("alert"), accountId, ...input, createdAt: t, updatedAt: t, createdBy: by, updatedBy: by };
    this.alerts.push(row);
    return { ...row };
  }

  async updateAlert(accountId: string, id: string, patch: { body?: string; priority?: AlertPriority }, by: Actor): Promise<AccountAlert | undefined> {
    const a = await this.getAlert(accountId, id);
    if (!a) return undefined;
    Object.assign(a, patch, { updatedAt: now(), updatedBy: by });
    return { ...a };
  }

  async deleteAlert(accountId: string, id: string): Promise<boolean> {
    if (!(await this.getAlert(accountId, id))) return false;
    this.alerts = this.alerts.filter((a) => a.id !== id);
    return true;
  }

  async listSops(accountId: string): Promise<AccountSop[]> {
    if (!this.owned(accountId)) return [];
    return this.sops
      .filter((s) => s.accountId === accountId)
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
      .map((s) => ({ ...s }));
  }

  async getSop(accountId: string, id: string): Promise<AccountSop | undefined> {
    const s = this.owned(accountId) ? this.sops.find((x) => x.id === id && x.accountId === accountId) : undefined;
    return s ? { ...s } : undefined;
  }

  async createSop(accountId: string, fields: SopFields, by: Actor): Promise<AccountSop> {
    const t = now();
    const row: AccountSop = { id: this.id("sop"), accountId, ...fields, version: 1, createdAt: t, updatedAt: t, createdBy: by, updatedBy: by };
    this.sops.push(row);
    return { ...row };
  }

  async updateSop(accountId: string, id: string, patch: Partial<SopFields>, by: Actor): Promise<AccountSop | undefined> {
    const s = this.owned(accountId) ? this.sops.find((x) => x.id === id && x.accountId === accountId) : undefined;
    if (!s) return undefined;
    this.revisions.push({
      id: this.id("rev"),
      sopId: id,
      version: s.version,
      title: s.title,
      category: s.category,
      summary: s.summary,
      warnings: s.warnings,
      steps: s.steps.map((x) => ({ ...x })),
      body: s.body,
      status: s.status,
      editedAt: s.updatedAt,
      editedBy: s.updatedBy,
    });
    Object.assign(s, patch, { version: s.version + 1, updatedAt: now(), updatedBy: by });
    return { ...s };
  }

  async listSopRevisions(accountId: string, sopId: string): Promise<AccountSopRevision[]> {
    if (!(await this.getSop(accountId, sopId))) return [];
    return this.revisions.filter((r) => r.sopId === sopId).sort((a, b) => b.version - a.version);
  }

  async listNotes(accountId: string): Promise<AccountNote[]> {
    if (!this.owned(accountId)) return [];
    return this.notes.filter((n) => n.accountId === accountId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getNote(accountId: string, id: string): Promise<AccountNote | undefined> {
    return this.owned(accountId) ? this.notes.find((n) => n.id === id && n.accountId === accountId) : undefined;
  }

  async createNote(accountId: string, input: { title: string; body: string; category: string }, by: Actor): Promise<AccountNote> {
    const t = now();
    const row: AccountNote = { id: this.id("note"), accountId, ...input, createdAt: t, updatedAt: t, createdBy: by, updatedBy: by };
    this.notes.push(row);
    return { ...row };
  }

  async updateNote(accountId: string, id: string, patch: { title?: string; body?: string; category?: string }, by: Actor): Promise<AccountNote | undefined> {
    const n = await this.getNote(accountId, id);
    if (!n) return undefined;
    Object.assign(n, patch, { updatedAt: now(), updatedBy: by });
    return { ...n };
  }

  async deleteNote(accountId: string, id: string): Promise<boolean> {
    if (!(await this.getNote(accountId, id))) return false;
    this.notes = this.notes.filter((n) => n.id !== id);
    return true;
  }

  async listResources(accountId: string): Promise<ResourceRow[]> {
    if (!this.owned(accountId)) return [];
    return this.resources
      .filter((r) => r.accountId === accountId)
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  async getResource(accountId: string, id: string): Promise<ResourceRow | undefined> {
    return this.owned(accountId) ? this.resources.find((r) => r.id === id && r.accountId === accountId) : undefined;
  }

  async createResource(
    accountId: string,
    input: Omit<ResourceRow, "id" | "accountId" | "createdAt" | "updatedAt" | "createdBy">,
    by: Actor,
  ): Promise<ResourceRow> {
    const t = now();
    const row: ResourceRow = { id: this.id("res"), accountId, ...input, createdAt: t, updatedAt: t, createdBy: by };
    this.resources.push(row);
    return { ...row };
  }

  async updateResource(
    accountId: string,
    id: string,
    patch: Partial<Omit<ResourceRow, "id" | "accountId" | "kind" | "attachmentId" | "createdAt" | "updatedAt" | "createdBy">>,
  ): Promise<ResourceRow | undefined> {
    const r = await this.getResource(accountId, id);
    if (!r) return undefined;
    Object.assign(r, patch, { updatedAt: now() });
    return { ...r };
  }

  async deleteResource(accountId: string, id: string): Promise<boolean> {
    if (!(await this.getResource(accountId, id))) return false;
    this.resources = this.resources.filter((r) => r.id !== id);
    return true;
  }

  async logActivity(accountId: string, by: Actor | null, action: string, summary: string): Promise<void> {
    this.activity.push({ id: this.id("act"), accountId, actor: by, action, summary, createdAt: now() });
  }

  async listActivity(accountId: string, limit: number): Promise<AccountActivity[]> {
    if (!this.owned(accountId)) return [];
    return this.activity
      .filter((a) => a.accountId === accountId)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  async getConversationAccount(conversationId: string): Promise<string | null> {
    const id = this.conversationAccount.get(conversationId) ?? null;
    return id && this.owned(id) ? id : null;
  }

  async setConversationAccount(conversationId: string, accountId: string | null): Promise<void> {
    this.conversationAccount.set(conversationId, accountId);
  }
}
