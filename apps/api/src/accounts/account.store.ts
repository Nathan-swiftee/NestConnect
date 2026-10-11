import type {
  AccountActivity,
  AccountAlert,
  AccountNote,
  AccountSop,
  AccountSopRevision,
  AccountStatus,
  Actor,
  AlertPriority,
  ResourceKind,
  SopStatus,
  SopStep,
} from "@ding/schemas";

/**
 * Persistence for organisations (customer accounts) and their knowledge.
 *
 * Its own store rather than more methods on the core `Store`: the module is
 * self-contained, and the two implementations follow the same rule as the core
 * one — Postgres in production (tenant-scoped client), in-memory for dev and
 * the checks. Everything here acts in the bound workspace.
 *
 * Rows come back without the names of people and files they refer to; the
 * service fills those in from the core store.
 */

/** An organisation as stored (owner and actors by id/name, no counts). */
export interface AccountRow {
  id: string;
  orgId: string;
  name: string;
  nameKey: string;
  legalName: string | null;
  reference: string | null;
  summary: string;
  overview: string;
  status: AccountStatus;
  tags: string[];
  ownerUserId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: Actor | null;
  updatedBy: Actor | null;
}

export type AccountFields = Omit<AccountRow, "id" | "orgId" | "archivedAt" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;

export interface AccountCounts {
  contactCount: number;
  alertCount: number;
  sopCount: number;
}

export interface LinkRow {
  accountId: string;
  contactId: string;
  role: string | null;
  department: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
}

export interface ResourceRow {
  id: string;
  accountId: string;
  kind: ResourceKind;
  title: string;
  description: string;
  category: string;
  url: string | null;
  instructions: string;
  attachmentId: string | null;
  sopId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: Actor | null;
}

export interface SopFields {
  title: string;
  category: string;
  summary: string;
  warnings: string;
  steps: SopStep[];
  body: string;
  status: SopStatus;
}

export interface ListAccountsQuery {
  search?: string;
  status?: AccountStatus;
  includeArchived?: boolean;
}

export abstract class AccountStore {
  abstract list(query: ListAccountsQuery): Promise<Array<AccountRow & AccountCounts>>;
  abstract get(id: string): Promise<AccountRow | undefined>;
  abstract counts(id: string): Promise<AccountCounts>;
  /** Organisations whose name reads the same (see accountNameKey), or with this reference. */
  abstract findSimilar(nameKey: string, reference: string | null): Promise<AccountRow[]>;
  abstract create(fields: AccountFields, actor: Actor): Promise<AccountRow>;
  abstract update(id: string, patch: Partial<AccountFields>, actor: Actor): Promise<AccountRow | undefined>;
  abstract setArchived(id: string, archived: boolean, actor: Actor): Promise<AccountRow | undefined>;

  abstract listLinks(accountId: string): Promise<LinkRow[]>;
  abstract linksForContact(contactId: string): Promise<LinkRow[]>;
  /** Link (or update the existing link's details). */
  abstract link(accountId: string, contactId: string, details: Omit<LinkRow, "accountId" | "contactId" | "createdAt">): Promise<LinkRow>;
  abstract updateLink(accountId: string, contactId: string, patch: Partial<Omit<LinkRow, "accountId" | "contactId" | "createdAt">>): Promise<LinkRow | undefined>;
  abstract unlink(accountId: string, contactId: string): Promise<boolean>;

  abstract listAlerts(accountId: string): Promise<AccountAlert[]>;
  abstract getAlert(accountId: string, id: string): Promise<AccountAlert | undefined>;
  abstract createAlert(accountId: string, input: { body: string; priority: AlertPriority }, actor: Actor): Promise<AccountAlert>;
  abstract updateAlert(accountId: string, id: string, patch: { body?: string; priority?: AlertPriority }, actor: Actor): Promise<AccountAlert | undefined>;
  abstract deleteAlert(accountId: string, id: string): Promise<boolean>;

  abstract listSops(accountId: string): Promise<AccountSop[]>;
  abstract getSop(accountId: string, id: string): Promise<AccountSop | undefined>;
  abstract createSop(accountId: string, fields: SopFields, actor: Actor): Promise<AccountSop>;
  /** Saves the change as a new version; the version it replaces goes to the history. */
  abstract updateSop(accountId: string, id: string, patch: Partial<SopFields>, actor: Actor): Promise<AccountSop | undefined>;
  abstract listSopRevisions(accountId: string, sopId: string): Promise<AccountSopRevision[]>;

  abstract listNotes(accountId: string): Promise<AccountNote[]>;
  abstract getNote(accountId: string, id: string): Promise<AccountNote | undefined>;
  abstract createNote(accountId: string, input: { title: string; body: string; category: string }, actor: Actor): Promise<AccountNote>;
  abstract updateNote(accountId: string, id: string, patch: { title?: string; body?: string; category?: string }, actor: Actor): Promise<AccountNote | undefined>;
  abstract deleteNote(accountId: string, id: string): Promise<boolean>;

  abstract listResources(accountId: string): Promise<ResourceRow[]>;
  abstract getResource(accountId: string, id: string): Promise<ResourceRow | undefined>;
  abstract createResource(accountId: string, input: Omit<ResourceRow, "id" | "accountId" | "createdAt" | "updatedAt" | "createdBy">, actor: Actor): Promise<ResourceRow>;
  abstract updateResource(accountId: string, id: string, patch: Partial<Omit<ResourceRow, "id" | "accountId" | "kind" | "attachmentId" | "createdAt" | "updatedAt" | "createdBy">>): Promise<ResourceRow | undefined>;
  abstract deleteResource(accountId: string, id: string): Promise<boolean>;

  abstract logActivity(accountId: string, actor: Actor | null, action: string, summary: string): Promise<void>;
  abstract listActivity(accountId: string, limit: number): Promise<AccountActivity[]>;

  /** The organisation chosen for a conversation, if any. */
  abstract getConversationAccount(conversationId: string): Promise<string | null>;
  abstract setConversationAccount(conversationId: string, accountId: string | null): Promise<void>;
}
