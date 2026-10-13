import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
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
import { PrismaService } from "../data/prisma.service";
import { tenantScoped, type TenantPrisma } from "../data/tenant-prisma";
import { currentOrgId } from "../tenancy/tenant-scope";
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

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const actor = (id: string | null | undefined, name: string | null | undefined): Actor | null =>
  id || name ? { id: id ?? null, name: name ?? "Someone" } : null;
const steps = (v: Prisma.JsonValue): SopStep[] =>
  Array.isArray(v) ? v.filter((s): s is { text: string } => !!s && typeof (s as { text?: unknown }).text === "string").map((s) => ({ text: s.text })) : [];

type AccountRecord = Prisma.AccountGetPayload<object>;
function mapAccount(r: AccountRecord): AccountRow {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    nameKey: r.nameKey,
    legalName: r.legalName,
    reference: r.reference,
    summary: r.summary,
    overview: r.overview,
    status: r.status as AccountStatus,
    tags: r.tags,
    ownerUserId: r.ownerUserId,
    routeTeamId: r.routeTeamId,
    routeUserId: r.routeUserId,
    phone: r.phone,
    email: r.email,
    website: r.website,
    address: r.address,
    archivedAt: iso(r.archivedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: actor(r.createdById, r.createdByName),
    updatedBy: actor(r.updatedById, r.updatedByName),
  };
}

function mapLink(r: Prisma.AccountContactGetPayload<object>): LinkRow {
  return {
    accountId: r.accountId,
    contactId: r.contactId,
    role: r.role,
    department: r.department,
    isPrimary: r.isPrimary,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

function mapAlert(r: Prisma.AccountAlertGetPayload<object>): AccountAlert {
  return {
    id: r.id,
    accountId: r.accountId,
    body: r.body,
    priority: r.priority as AlertPriority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: actor(r.createdById, r.createdByName),
    updatedBy: actor(r.updatedById, r.updatedByName),
  };
}

function mapSop(r: Prisma.AccountSopGetPayload<object>): AccountSop {
  return {
    id: r.id,
    accountId: r.accountId,
    title: r.title,
    category: r.category,
    summary: r.summary,
    warnings: r.warnings,
    steps: steps(r.steps),
    body: r.body,
    status: r.status as SopStatus,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: actor(r.createdById, r.createdByName),
    updatedBy: actor(r.updatedById, r.updatedByName),
  };
}

function mapNote(r: Prisma.AccountNoteGetPayload<object>): AccountNote {
  return {
    id: r.id,
    accountId: r.accountId,
    title: r.title,
    body: r.body,
    category: r.category,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: actor(r.createdById, r.createdByName),
    updatedBy: actor(r.updatedById, r.updatedByName),
  };
}

function mapResource(r: Prisma.AccountResourceGetPayload<object>): ResourceRow {
  return {
    id: r.id,
    accountId: r.accountId,
    kind: r.kind as ResourceKind,
    title: r.title,
    description: r.description,
    category: r.category,
    url: r.url,
    instructions: r.instructions,
    attachmentId: r.attachmentId,
    sopId: r.sopId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: actor(r.createdById, r.createdByName),
  };
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, important: 1, info: 2 };

@Injectable()
export class PrismaAccountStore extends AccountStore {
  /** Tenant-scoped: every query is confined to the bound workspace. */
  private readonly prisma: TenantPrisma;

  constructor(root: PrismaService) {
    super();
    this.prisma = tenantScoped(root);
  }

  async list(query: ListAccountsQuery): Promise<Array<AccountRow & AccountCounts>> {
    const search = query.search?.trim();
    const rows = await this.prisma.account.findMany({
      where: {
        ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { legalName: { contains: search, mode: "insensitive" } },
                { reference: { contains: search, mode: "insensitive" } },
                { summary: { contains: search, mode: "insensitive" } },
                { tags: { has: search.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: 1000,
      include: {
        _count: { select: { contacts: true, alerts: true, sops: { where: { status: "active" } } } },
      },
    });
    return rows.map((r) => ({
      ...mapAccount(r),
      contactCount: r._count.contacts,
      alertCount: r._count.alerts,
      sopCount: r._count.sops,
    }));
  }

  async get(id: string): Promise<AccountRow | undefined> {
    const r = await this.prisma.account.findUnique({ where: { id } });
    return r ? mapAccount(r) : undefined;
  }

  async counts(id: string): Promise<AccountCounts> {
    const [contactCount, alertCount, sopCount] = await Promise.all([
      this.prisma.accountContact.count({ where: { accountId: id } }),
      this.prisma.accountAlert.count({ where: { accountId: id } }),
      this.prisma.accountSop.count({ where: { accountId: id, status: "active" } }),
    ]);
    return { contactCount, alertCount, sopCount };
  }

  async findSimilar(nameKey: string, reference: string | null): Promise<AccountRow[]> {
    const rows = await this.prisma.account.findMany({
      where: { OR: [{ nameKey }, ...(reference ? [{ reference: { equals: reference, mode: "insensitive" as const } }] : [])] },
      take: 5,
    });
    return rows.map(mapAccount);
  }

  async create(fields: AccountFields, by: Actor): Promise<AccountRow> {
    const r = await this.prisma.account.create({
      data: {
        orgId: currentOrgId(),
        ...fields,
        createdById: by.id,
        createdByName: by.name,
        updatedById: by.id,
        updatedByName: by.name,
      },
    });
    return mapAccount(r);
  }

  async update(id: string, patch: Partial<AccountFields>, by: Actor): Promise<AccountRow | undefined> {
    const found = await this.prisma.account.findUnique({ where: { id }, select: { id: true } });
    if (!found) return undefined;
    const r = await this.prisma.account.update({
      where: { id },
      data: { ...patch, updatedById: by.id, updatedByName: by.name },
    });
    return mapAccount(r);
  }

  async setArchived(id: string, archived: boolean, by: Actor): Promise<AccountRow | undefined> {
    const found = await this.prisma.account.findUnique({ where: { id }, select: { id: true } });
    if (!found) return undefined;
    const r = await this.prisma.account.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, updatedById: by.id, updatedByName: by.name },
    });
    return mapAccount(r);
  }

  async remove(id: string): Promise<boolean> {
    // Scoped by the tenant client, so another workspace's id finds nothing.
    // Every child row cascades in the schema; Conversation.accountId is set null.
    const found = await this.prisma.account.findUnique({ where: { id }, select: { id: true } });
    if (!found) return false;
    await this.prisma.account.delete({ where: { id } });
    return true;
  }

  async listLinks(accountId: string): Promise<LinkRow[]> {
    const rows = await this.prisma.accountContact.findMany({
      where: { accountId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(mapLink);
  }

  async linksForContact(contactId: string): Promise<LinkRow[]> {
    const rows = await this.prisma.accountContact.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } });
    return rows.map(mapLink);
  }

  async link(accountId: string, contactId: string, details: Omit<LinkRow, "accountId" | "contactId" | "createdAt">): Promise<LinkRow> {
    const existing = await this.prisma.accountContact.findFirst({ where: { accountId, contactId } });
    const r = existing
      ? await this.prisma.accountContact.update({ where: { id: existing.id }, data: details })
      : await this.prisma.accountContact.create({ data: { accountId, contactId, ...details } });
    return mapLink(r);
  }

  async updateLink(accountId: string, contactId: string, patch: Partial<Omit<LinkRow, "accountId" | "contactId" | "createdAt">>): Promise<LinkRow | undefined> {
    const existing = await this.prisma.accountContact.findFirst({ where: { accountId, contactId } });
    if (!existing) return undefined;
    return mapLink(await this.prisma.accountContact.update({ where: { id: existing.id }, data: patch }));
  }

  async unlink(accountId: string, contactId: string): Promise<boolean> {
    const res = await this.prisma.accountContact.deleteMany({ where: { accountId, contactId } });
    return res.count > 0;
  }

  async listAlerts(accountId: string): Promise<AccountAlert[]> {
    const rows = await this.prisma.accountAlert.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } });
    return rows.map(mapAlert).sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  }

  async getAlert(accountId: string, id: string): Promise<AccountAlert | undefined> {
    const r = await this.prisma.accountAlert.findFirst({ where: { id, accountId } });
    return r ? mapAlert(r) : undefined;
  }

  async createAlert(accountId: string, input: { body: string; priority: AlertPriority }, by: Actor): Promise<AccountAlert> {
    return mapAlert(
      await this.prisma.accountAlert.create({
        data: { accountId, ...input, createdById: by.id, createdByName: by.name, updatedById: by.id, updatedByName: by.name },
      }),
    );
  }

  async updateAlert(accountId: string, id: string, patch: { body?: string; priority?: AlertPriority }, by: Actor): Promise<AccountAlert | undefined> {
    if (!(await this.getAlert(accountId, id))) return undefined;
    return mapAlert(
      await this.prisma.accountAlert.update({ where: { id }, data: { ...patch, updatedById: by.id, updatedByName: by.name } }),
    );
  }

  async deleteAlert(accountId: string, id: string): Promise<boolean> {
    return (await this.prisma.accountAlert.deleteMany({ where: { id, accountId } })).count > 0;
  }

  async listSops(accountId: string): Promise<AccountSop[]> {
    const rows = await this.prisma.accountSop.findMany({ where: { accountId }, orderBy: [{ category: "asc" }, { title: "asc" }] });
    return rows.map(mapSop);
  }

  async getSop(accountId: string, id: string): Promise<AccountSop | undefined> {
    const r = await this.prisma.accountSop.findFirst({ where: { id, accountId } });
    return r ? mapSop(r) : undefined;
  }

  async createSop(accountId: string, fields: SopFields, by: Actor): Promise<AccountSop> {
    return mapSop(
      await this.prisma.accountSop.create({
        data: {
          accountId,
          ...fields,
          steps: fields.steps as unknown as Prisma.InputJsonValue,
          createdById: by.id,
          createdByName: by.name,
          updatedById: by.id,
          updatedByName: by.name,
        },
      }),
    );
  }

  async updateSop(accountId: string, id: string, patch: Partial<SopFields>, by: Actor): Promise<AccountSop | undefined> {
    const before = await this.prisma.accountSop.findFirst({ where: { id, accountId } });
    if (!before) return undefined;
    const [, after] = await this.prisma.$transaction([
      // The version being replaced, exactly as it read.
      this.prisma.accountSopRevision.create({
        data: {
          sopId: id,
          version: before.version,
          title: before.title,
          category: before.category,
          summary: before.summary,
          warnings: before.warnings,
          steps: before.steps as Prisma.InputJsonValue,
          body: before.body,
          status: before.status,
          editedAt: before.updatedAt,
          editedById: before.updatedById,
          editedByName: before.updatedByName,
        },
      }),
      this.prisma.accountSop.update({
        where: { id },
        data: {
          ...patch,
          ...(patch.steps ? { steps: patch.steps as unknown as Prisma.InputJsonValue } : {}),
          version: { increment: 1 },
          updatedById: by.id,
          updatedByName: by.name,
        },
      }),
    ]);
    return mapSop(after);
  }

  async listSopRevisions(accountId: string, sopId: string): Promise<AccountSopRevision[]> {
    if (!(await this.getSop(accountId, sopId))) return [];
    const rows = await this.prisma.accountSopRevision.findMany({ where: { sopId }, orderBy: { version: "desc" }, take: 100 });
    return rows.map((r) => ({
      id: r.id,
      sopId: r.sopId,
      version: r.version,
      title: r.title,
      category: r.category,
      summary: r.summary,
      warnings: r.warnings,
      steps: steps(r.steps),
      body: r.body,
      status: r.status as SopStatus,
      editedAt: r.editedAt.toISOString(),
      editedBy: actor(r.editedById, r.editedByName),
    }));
  }

  async listNotes(accountId: string): Promise<AccountNote[]> {
    const rows = await this.prisma.accountNote.findMany({ where: { accountId }, orderBy: { updatedAt: "desc" } });
    return rows.map(mapNote);
  }

  async getNote(accountId: string, id: string): Promise<AccountNote | undefined> {
    const r = await this.prisma.accountNote.findFirst({ where: { id, accountId } });
    return r ? mapNote(r) : undefined;
  }

  async createNote(accountId: string, input: { title: string; body: string; category: string }, by: Actor): Promise<AccountNote> {
    return mapNote(
      await this.prisma.accountNote.create({
        data: { accountId, ...input, createdById: by.id, createdByName: by.name, updatedById: by.id, updatedByName: by.name },
      }),
    );
  }

  async updateNote(accountId: string, id: string, patch: { title?: string; body?: string; category?: string }, by: Actor): Promise<AccountNote | undefined> {
    if (!(await this.getNote(accountId, id))) return undefined;
    return mapNote(
      await this.prisma.accountNote.update({ where: { id }, data: { ...patch, updatedById: by.id, updatedByName: by.name } }),
    );
  }

  async deleteNote(accountId: string, id: string): Promise<boolean> {
    return (await this.prisma.accountNote.deleteMany({ where: { id, accountId } })).count > 0;
  }

  async listResources(accountId: string): Promise<ResourceRow[]> {
    const rows = await this.prisma.accountResource.findMany({ where: { accountId }, orderBy: [{ category: "asc" }, { title: "asc" }] });
    return rows.map(mapResource);
  }

  async getResource(accountId: string, id: string): Promise<ResourceRow | undefined> {
    const r = await this.prisma.accountResource.findFirst({ where: { id, accountId } });
    return r ? mapResource(r) : undefined;
  }

  async createResource(
    accountId: string,
    input: Omit<ResourceRow, "id" | "accountId" | "createdAt" | "updatedAt" | "createdBy">,
    by: Actor,
  ): Promise<ResourceRow> {
    return mapResource(
      await this.prisma.accountResource.create({ data: { accountId, ...input, createdById: by.id, createdByName: by.name } }),
    );
  }

  async updateResource(
    accountId: string,
    id: string,
    patch: Partial<Omit<ResourceRow, "id" | "accountId" | "kind" | "attachmentId" | "createdAt" | "updatedAt" | "createdBy">>,
  ): Promise<ResourceRow | undefined> {
    if (!(await this.getResource(accountId, id))) return undefined;
    return mapResource(await this.prisma.accountResource.update({ where: { id }, data: patch }));
  }

  async deleteResource(accountId: string, id: string): Promise<boolean> {
    return (await this.prisma.accountResource.deleteMany({ where: { id, accountId } })).count > 0;
  }

  async logActivity(accountId: string, by: Actor | null, action: string, summary: string): Promise<void> {
    await this.prisma.accountActivity.create({
      data: { accountId, actorId: by?.id ?? null, actorName: by?.name ?? null, action, summary },
    });
  }

  async listActivity(accountId: string, limit: number): Promise<AccountActivity[]> {
    const rows = await this.prisma.accountActivity.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      actor: actor(r.actorId, r.actorName),
      action: r.action,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getConversationAccount(conversationId: string): Promise<string | null> {
    const r = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { accountId: true } });
    return r?.accountId ?? null;
  }

  async setConversationAccount(conversationId: string, accountId: string | null): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { accountId } });
  }
}
