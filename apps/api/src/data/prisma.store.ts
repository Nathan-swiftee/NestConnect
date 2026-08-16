import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { hashInviteToken, newInviteToken } from "../auth/invite-token";
import { normalizeIdentity, type IdentityKind } from "../contacts/identity";
import { groupDuplicateContacts } from "../contacts/duplicates";
import type { Prisma } from "@prisma/client";
import type {
  Attachment,
  ChannelType,
  Contact,
  ContactDuplicateGroup,
  ContactWithConversations,
  Conversation,
  ConversationPage,
  ConversationStatus,
  ConversationWithMessages,
  CreateTemplateInput,
  Inbox,
  Label,
  Member,
  Message,
  MessagePage,
  MessageStatus,
  Notification,
  Participant,
  ParticipantRole,
  Priority,
  Role,
  RoutingStrategy,
  Team,
  Template,
  UpdateTemplateInput,
  User,
} from "@ding/schemas";
import { CONVERSATIONS_PAGE_SIZE, MESSAGES_PAGE_SIZE } from "@ding/schemas";
import { env } from "../config/env";
import { DEMO_USER_ID, ORG_ID } from "./fixtures";
import {
  canAdvanceStatus,
  isWaChannel,
  mapAttachment,
  mapContact,
  mapConversation,
  mapInbox,
  mapMessage,
  mapNotification,
  mapParticipant,
  mapTeam,
  mapTemplate,
  mapUser,
  messageTypeForKind,
  parseReactions,
  previewForType,
  sameTemplateLang,
} from "./mappers";
import { PrismaService } from "./prisma.service";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import {
  Store,
  type AppendInboundInput,
  type AttachmentInput,
  type MessageStatusChange,
  type OutboundDeliveryMeta,
  type OutboundMessageRef,
  type SidebarViews,
  type StoredAttachmentRef,
  type ViewItem,
  type WebhookDiagnostic,
} from "./store";

const convInclude = {
  contact: { include: { identities: true } },
  labels: { include: { label: true } },
  // The assignee's name, so the summary can show the real owner (not just "You").
  assignee: { select: { name: true } },
  // The most recent customer-facing message, purely so the summary can report
  // its channel (the list badge shows the last channel used, not the origin).
  messages: { where: { internal: false }, orderBy: { seq: "desc" }, take: 1 },
} satisfies Prisma.ConversationInclude;

/** Keyset cursor for the (lastActivityAt desc, id desc) conversation ordering. */
function encodeConvCursor(row: { lastActivityAt: Date; id: string }): string {
  return Buffer.from(`${row.lastActivityAt.toISOString()}::${row.id}`).toString("base64url");
}
function decodeConvCursor(cursor?: string): { t: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const [t, id] = Buffer.from(cursor, "base64url").toString("utf8").split("::");
    const date = new Date(t);
    return id && !Number.isNaN(date.getTime()) ? { t: date, id } : undefined;
  } catch {
    return undefined;
  }
}
/** Clamp a requested page size into a sane range. */
function pageLimit(requested: number | undefined, fallback: number): number {
  const n = requested ?? fallback;
  return Math.min(Math.max(Math.trunc(n) || fallback, 1), 100);
}
/** Keyset predicate: rows strictly after the cursor in (lastActivityAt, id) desc. */
function keysetBefore(cur: { t: Date; id: string }): Prisma.ConversationWhereInput {
  return {
    OR: [
      { lastActivityAt: { lt: cur.t } },
      { AND: [{ lastActivityAt: cur.t }, { id: { lt: cur.id } }] },
    ],
  };
}

const AVATAR_PALETTE = [
  "linear-gradient(135deg,#F97316,#DB2777)",
  "linear-gradient(135deg,#0EA5E9,#2563EB)",
  "linear-gradient(135deg,#10B981,#059669)",
  "linear-gradient(135deg,#6366F1,#A855F7)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#14B8A6,#0EA5E9)",
];

/** Postgres-backed store (active when DATABASE_URL is set). */
@Injectable()
export class PrismaStore extends Store {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretEncryptionService,
  ) {
    super();
  }

  get demoUserId(): string {
    return DEMO_USER_ID;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    return u ? mapUser(u) : undefined;
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const u = await this.prisma.user.findFirst({
      where: { orgId: ORG_ID, email: { equals: email, mode: "insensitive" } },
    });
    return u ? mapUser(u) : undefined;
  }

  async getPasswordHash(userId: string): Promise<string | undefined> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    return u?.passwordHash ?? undefined;
  }

  async createInbox(params: {
    orgId: string;
    type: ChannelType;
    name: string;
    handle: string;
    teamIds: string[];
    routingStrategy: RoutingStrategy;
    channelConfig?: Record<string, string>;
  }): Promise<Inbox> {
    const created = await this.prisma.inbox.create({
      data: {
        orgId: params.orgId,
        type: params.type,
        name: params.name,
        handle: params.handle,
        routingStrategy: params.routingStrategy,
        // Encrypt credential fields (accessToken/providerToken/refreshToken) at rest.
        channelConfig: params.channelConfig
          ? this.crypto.encryptChannelConfig(params.channelConfig)
          : undefined,
        teams: { create: params.teamIds.map((teamId) => ({ teamId })) },
      },
      include: { teams: true },
    });
    return mapInbox(created);
  }

  async updateInbox(
    id: string,
    params: {
      name?: string;
      teamIds?: string[];
      routingStrategy?: RoutingStrategy;
      channelConfig?: Record<string, string>;
    },
  ): Promise<Inbox | undefined> {
    const existing = await this.prisma.inbox.findUnique({ where: { id } });
    if (!existing) return undefined;
    // Merge new (plaintext) fields over the stored config, encrypting the
    // incoming secret fields. Existing secret fields are already ciphertext and
    // are preserved as-is (encrypt() is idempotent, so no double-encryption).
    const mergedConfig =
      params.channelConfig !== undefined
        ? {
            ...((existing.channelConfig as Record<string, string> | null) ?? {}),
            ...this.crypto.encryptChannelConfig(params.channelConfig),
          }
        : undefined;
    const updated = await this.prisma.inbox.update({
      where: { id },
      data: {
        name: params.name ?? undefined,
        routingStrategy: params.routingStrategy ?? undefined,
        ...(mergedConfig !== undefined ? { channelConfig: mergedConfig } : {}),
        ...(params.teamIds !== undefined
          ? { teams: { deleteMany: {}, create: params.teamIds.map((teamId) => ({ teamId })) } }
          : {}),
      },
      include: { teams: true },
    });
    return mapInbox(updated);
  }

  async deleteInbox(id: string): Promise<void> {
    const convs = await this.prisma.conversation.findMany({ where: { inboxId: id }, select: { id: true } });
    const convIds = convs.map((c) => c.id);
    const msgs = convIds.length
      ? await this.prisma.message.findMany({ where: { conversationId: { in: convIds } }, select: { id: true } })
      : [];
    const msgIds = msgs.map((m) => m.id);
    // No DB-level cascade, so tear down children before the inbox, in FK order.
    await this.prisma.$transaction([
      ...(msgIds.length ? [this.prisma.attachment.deleteMany({ where: { messageId: { in: msgIds } } })] : []),
      ...(convIds.length
        ? [
            this.prisma.message.deleteMany({ where: { conversationId: { in: convIds } } }),
            this.prisma.participant.deleteMany({ where: { conversationId: { in: convIds } } }),
            this.prisma.note.deleteMany({ where: { conversationId: { in: convIds } } }),
            this.prisma.conversationLabel.deleteMany({ where: { conversationId: { in: convIds } } }),
            this.prisma.assignmentEvent.deleteMany({ where: { conversationId: { in: convIds } } }),
            this.prisma.conversation.deleteMany({ where: { inboxId: id } }),
          ]
        : []),
      this.prisma.inboxTeam.deleteMany({ where: { inboxId: id } }),
      this.prisma.inbox.delete({ where: { id } }),
    ]);
  }

  async getInbox(id: string): Promise<Inbox | undefined> {
    const row = await this.prisma.inbox.findUnique({ where: { id }, include: { teams: true } });
    return row ? mapInbox(row) : undefined;
  }

  async getInboxConfig(id: string): Promise<Record<string, string> | undefined> {
    const row = await this.prisma.inbox.findUnique({
      where: { id },
      select: { channelConfig: true },
    });
    const config = (row?.channelConfig as Record<string, string> | null) ?? undefined;
    // Decrypt credential fields so callers (providers) get plaintext tokens.
    return config ? this.crypto.decryptChannelConfig(config) : undefined;
  }

  async getAppSetting(orgId: string, key: string): Promise<string | undefined> {
    const row = await this.prisma.appSetting.findUnique({
      where: { orgId_key: { orgId, key } },
    });
    if (row?.value == null) return undefined;
    return this.crypto.decryptAppSetting(key, row.value);
  }

  async setAppSetting(orgId: string, key: string, value: string): Promise<void> {
    const stored = this.crypto.encryptAppSetting(key, value);
    await this.prisma.appSetting.upsert({
      where: { orgId_key: { orgId, key } },
      create: { orgId, key, value: stored },
      update: { value: stored },
    });
  }

  /* ---- message templates ---- */

  async listTemplates(orgId: string): Promise<Template[]> {
    const rows = await this.prisma.template.findMany({
      where: { orgId },
      orderBy: [{ name: "asc" }, { language: "asc" }],
    });
    return rows.map(mapTemplate);
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    const row = await this.prisma.template.findUnique({ where: { id } });
    return row ? mapTemplate(row) : undefined;
  }

  async createTemplate(orgId: string, input: CreateTemplateInput): Promise<Template> {
    const row = await this.prisma.template.create({
      data: {
        orgId,
        name: input.name,
        category: input.category,
        language: input.language,
        body: input.body,
        approvalStatus: "draft",
      },
    });
    return mapTemplate(row);
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<Template | undefined> {
    try {
      const row = await this.prisma.template.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.approvalStatus !== undefined ? { approvalStatus: input.approvalStatus } : {}),
        },
      });
      return mapTemplate(row);
    } catch {
      return undefined;
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.prisma.template.delete({ where: { id } }).catch(() => {});
  }

  async upsertTemplateByName(
    orgId: string,
    input: CreateTemplateInput & { approvalStatus: Template["approvalStatus"] },
  ): Promise<Template> {
    // Match the exact (name, language) first; fall back to the same primary
    // language so Meta's locale-qualified "en_US" updates a locally-stored "en"
    // copy rather than inserting a stale duplicate.
    const sameName = await this.prisma.template.findMany({ where: { orgId, name: input.name } });
    const match =
      sameName.find((t) => t.language === input.language) ??
      sameName.find((t) => sameTemplateLang(t.language, input.language));
    const fields = {
      category: input.category,
      body: input.body,
      approvalStatus: input.approvalStatus,
    };
    const row = match
      ? await this.prisma.template.update({
          where: { id: match.id },
          // Adopt Meta's exact language code so outbound template sends use the
          // code the template is actually approved under.
          data: { language: input.language, ...fields },
        })
      : await this.prisma.template.create({
          data: { orgId, name: input.name, language: input.language, ...fields },
        });
    return mapTemplate(row);
  }

  async listTeams(): Promise<Team[]> {
    const rows = await this.prisma.team.findMany({
      where: { orgId: ORG_ID },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return rows.map(mapTeam);
  }

  async listMembers(): Promise<Member[]> {
    const rows = await this.prisma.user.findMany({
      where: { orgId: ORG_ID },
      include: { memberships: true },
      orderBy: { name: "asc" },
    });
    return rows.map((u) => ({ user: mapUser(u), teamIds: u.memberships.map((m) => m.teamId) }));
  }

  async createTeam(params: { orgId: string; name: string; icon?: string; slaMinutes?: number | null }): Promise<Team> {
    const max = await this.prisma.team.aggregate({ where: { orgId: params.orgId }, _max: { order: true } });
    const t = await this.prisma.team.create({
      data: {
        orgId: params.orgId,
        name: params.name,
        icon: params.icon ?? null,
        order: (max._max.order ?? -1) + 1,
        slaMinutes: params.slaMinutes ?? null,
      },
    });
    return mapTeam(t);
  }

  async updateTeam(
    id: string,
    params: { name?: string; icon?: string | null; slaMinutes?: number | null },
  ): Promise<Team | undefined> {
    try {
      const t = await this.prisma.team.update({
        where: { id },
        data: {
          name: params.name ?? undefined,
          ...(params.icon !== undefined ? { icon: params.icon } : {}),
          ...(params.slaMinutes !== undefined ? { slaMinutes: params.slaMinutes } : {}),
        },
      });
      return mapTeam(t);
    } catch {
      return undefined;
    }
  }

  async getTeam(id: string): Promise<Team | undefined> {
    const t = await this.prisma.team.findUnique({ where: { id } });
    return t ? mapTeam(t) : undefined;
  }

  async reorderTeams(orderedIds: string[]): Promise<Team[]> {
    await this.prisma.$transaction(
      orderedIds.map((id, i) => this.prisma.team.update({ where: { id }, data: { order: i } })),
    );
    return this.listTeams();
  }

  async deleteTeam(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { teamId: id } });
      await tx.inboxTeam.deleteMany({ where: { teamId: id } });
      await tx.conversation.updateMany({ where: { assignedTeamId: id }, data: { assignedTeamId: null } });
      await tx.team.delete({ where: { id } });
    });
  }

  async createUser(params: {
    orgId: string;
    name: string;
    email: string;
    role: Role;
    teamIds: string[];
    password?: string;
  }): Promise<{ user: User; inviteToken?: string }> {
    // With a password → loginable now (seeding). Without → mint an invite token
    // and set a random unusable password until the invitee sets their own.
    const invite = params.password ? null : newInviteToken();
    const u = await this.prisma.user.create({
      data: {
        orgId: params.orgId,
        name: params.name,
        email: params.email,
        role: params.role,
        passwordHash: bcrypt.hashSync(params.password ?? randomBytes(24).toString("hex"), 8),
        inviteTokenHash: invite?.hash ?? null,
        inviteExpiresAt: invite?.expiresAt ?? null,
        memberships: { create: params.teamIds.map((teamId) => ({ teamId })) },
      },
    });
    return { user: mapUser(u), inviteToken: invite?.token };
  }

  async setPasswordByInviteToken(token: string, password: string): Promise<User | undefined> {
    const u = await this.prisma.user.findFirst({ where: { inviteTokenHash: hashInviteToken(token) } });
    if (!u || !u.inviteExpiresAt || u.inviteExpiresAt.getTime() < Date.now()) return undefined;
    const updated = await this.prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: bcrypt.hashSync(password, 8), inviteTokenHash: null, inviteExpiresAt: null },
    });
    return mapUser(updated);
  }

  async createPasswordResetToken(email: string): Promise<{ user: User; token: string } | null> {
    const u = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (!u) return null;
    const inv = newInviteToken();
    const updated = await this.prisma.user.update({
      where: { id: u.id },
      data: { inviteTokenHash: inv.hash, inviteExpiresAt: inv.expiresAt },
    });
    return { user: mapUser(updated), token: inv.token };
  }

  async updateUser(
    id: string,
    params: { name?: string; role?: Role; teamIds?: string[] },
  ): Promise<User | undefined> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const data: Prisma.UserUpdateInput = {};
        if (params.name !== undefined) data.name = params.name;
        if (params.role !== undefined) data.role = params.role;
        if (Object.keys(data).length) await tx.user.update({ where: { id }, data });
        if (params.teamIds !== undefined) {
          await tx.teamMember.deleteMany({ where: { userId: id } });
          if (params.teamIds.length) {
            await tx.teamMember.createMany({
              data: params.teamIds.map((teamId) => ({ userId: id, teamId })),
              skipDuplicates: true,
            });
          }
        }
      });
      const u = await this.prisma.user.findUnique({ where: { id } });
      return u ? mapUser(u) : undefined;
    } catch {
      return undefined;
    }
  }

  async updateMyPreferences(
    userId: string,
    params: { available?: boolean; emailSignature?: string | null },
  ): Promise<User | undefined> {
    try {
      const data: Prisma.UserUpdateInput = {};
      if (params.available !== undefined) data.available = params.available;
      if (params.emailSignature !== undefined) data.emailSignature = params.emailSignature;
      const u = await this.prisma.user.update({ where: { id: userId }, data });
      return mapUser(u);
    } catch {
      return undefined;
    }
  }

  async updateMyProfile(
    userId: string,
    params: { name?: string; email?: string; avatarUrl?: string | null },
  ): Promise<User | undefined> {
    try {
      const data: Prisma.UserUpdateInput = {};
      if (params.name !== undefined) data.name = params.name;
      if (params.email !== undefined) data.email = params.email;
      if (params.avatarUrl !== undefined) data.avatarUrl = params.avatarUrl;
      const u = await this.prisma.user.update({ where: { id: userId }, data });
      return mapUser(u);
    } catch {
      return undefined;
    }
  }

  async setUserPassword(userId: string, password: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: bcrypt.hashSync(password, 8) },
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { userId: id } });
      await tx.note.deleteMany({ where: { authorUserId: id } });
      await tx.conversation.updateMany({ where: { assigneeUserId: id }, data: { assigneeUserId: null } });
      await tx.message.updateMany({ where: { authorUserId: id }, data: { authorUserId: null } });
      await tx.user.delete({ where: { id } });
    });
  }

  async teamsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.teamMember.findMany({ where: { userId } });
    return rows.map((r) => r.teamId);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: { team: true },
    });
    return {
      user: user ? mapUser(user) : undefined,
      teams: memberships.map((m) => mapTeam(m.team)),
    };
  }

  async listInboxes(): Promise<Inbox[]> {
    const rows = await this.prisma.inbox.findMany({ where: { orgId: ORG_ID }, include: { teams: true } });
    return rows.map(mapInbox);
  }

  async getMembers(teamId: string): Promise<User[]> {
    const rows = await this.prisma.teamMember.findMany({ where: { teamId }, include: { user: true } });
    return rows.map((r) => mapUser(r.user));
  }

  private async mentionToken(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    return "@" + (u?.email.split("@")[0].toLowerCase() ?? "");
  }

  /**
   * `forCount` distinguishes the sidebar badge (active work only) from the
   * conversation list (which also carries closed items so the "Closed" filter
   * has something to show). Personal queues (inbound/grabs) stay active-only.
   */
  private buildWhere(
    view: string,
    userId: string,
    userTeams: string[],
    token: string,
    forCount = false,
  ): Prisma.ConversationWhereInput {
    const org = { orgId: ORG_ID };
    const active: Prisma.ConversationWhereInput = { status: { in: ["open", "pending"] } };
    // Lists carry closed items (for the Closed filter) but never snoozed ones —
    // those live only in "Later". Counts (badges) are active-only.
    const activeOnly: Prisma.ConversationWhereInput = forCount ? active : { status: { not: "snoozed" } };
    const mine: Prisma.ConversationWhereInput = { ...org, ...activeOnly, assigneeUserId: userId };
    const grabs: Prisma.ConversationWhereInput = {
      ...org,
      ...active,
      assigneeUserId: null,
      // routed to one of my teams, or unrouted on a channel that points at them
      OR: [
        { assignedTeamId: { in: userTeams } },
        { assignedTeamId: null, inbox: { teams: { some: { teamId: { in: userTeams } } } } },
      ],
    };
    if (view === "mine") return mine;
    if (view === "grabs") return grabs;
    if (view === "inbound") return { OR: [mine, grabs] };
    if (view === "snoozed") return { ...org, status: "snoozed" };
    if (view === "mentions") {
      return {
        ...org,
        messages: { some: { internal: true, body: { contains: token, mode: "insensitive" } } },
      };
    }
    if (view.startsWith("team:")) {
      const teamId = view.slice(5);
      // Routed to this team, or unrouted on a channel that points at it.
      return {
        ...org,
        ...activeOnly,
        OR: [
          { assignedTeamId: teamId },
          { assignedTeamId: null, inbox: { teams: { some: { teamId } } } },
        ],
      };
    }
    if (view.startsWith("inbox:")) return { ...org, ...activeOnly, inboxId: view.slice(6) };
    if (view.startsWith("label:"))
      return { ...org, ...activeOnly, labels: { some: { labelId: view.slice(6) } } };
    return { id: "__none__" };
  }

  async listConversations(
    view: string,
    userId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage> {
    const userTeams = await this.teamsForUser(userId);
    const token = await this.mentionToken(userId);
    const limit = pageLimit(opts?.limit, CONVERSATIONS_PAGE_SIZE);
    const cur = decodeConvCursor(opts?.cursor);
    const base = this.buildWhere(view, userId, userTeams, token);
    const where: Prisma.ConversationWhereInput = cur
      ? { AND: [base, keysetBefore(cur)] }
      : base;
    return this.pageConversations(where, limit);
  }

  async searchConversations(
    query: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage> {
    const q = query.trim();
    if (!q) return { items: [], nextCursor: null };
    const limit = pageLimit(opts?.limit, CONVERSATIONS_PAGE_SIZE);
    const cur = decodeConvCursor(opts?.cursor);
    const match: Prisma.ConversationWhereInput = {
      orgId: ORG_ID,
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { preview: { contains: q, mode: "insensitive" } },
        { contact: { displayName: { contains: q, mode: "insensitive" } } },
        { contact: { company: { contains: q, mode: "insensitive" } } },
        { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
      ],
    };
    const where: Prisma.ConversationWhereInput = cur ? { AND: [match, keysetBefore(cur)] } : match;
    return this.pageConversations(where, limit);
  }

  /** Run one keyset page of conversations and derive the next cursor. */
  private async pageConversations(
    where: Prisma.ConversationWhereInput,
    limit: number,
  ): Promise<ConversationPage> {
    const rows = await this.prisma.conversation.findMany({
      where,
      include: convInclude,
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      take: limit + 1, // one extra row tells us whether another page exists
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(mapConversation),
      nextCursor: hasMore && last ? encodeConvCursor(last) : null,
    };
  }

  async views(userId: string): Promise<SidebarViews> {
    const userTeams = await this.teamsForUser(userId);
    const token = await this.mentionToken(userId);
    // Admins & managers oversee the whole workspace: they see every team and
    // channel in the shared section, regardless of their own team memberships.
    // Personal queues (My Inbound / Mine / Queue) stay membership-scoped for all.
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const elevated = me?.role === "admin" || me?.role === "manager";
    const count = (view: string) =>
      this.prisma.conversation.count({ where: this.buildWhere(view, userId, userTeams, token, true) });
    const dueSnoozed = () =>
      this.prisma.conversation.count({
        where: { orgId: ORG_ID, status: "snoozed", snoozedUntil: { lte: new Date() } },
      });

    const my: ViewItem[] = [
      { key: "inbound", title: "My Inbound", count: await count("inbound") },
      { key: "mine", title: "Mine", count: await count("mine") },
      { key: "grabs", title: "Queue", count: await count("grabs") },
      { key: "mentions", title: "@ Mentions", count: await count("mentions") },
      { key: "snoozed", title: "Later", count: await count("snoozed"), due: await dueSnoozed() },
    ];

    const teamRows = await this.prisma.team.findMany({
      where: elevated ? { orgId: ORG_ID } : { id: { in: userTeams } },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    const teams: ViewItem[] = [];
    for (const t of teamRows) {
      teams.push({ key: `team:${t.id}`, title: t.name, count: await count(`team:${t.id}`) });
    }

    const inboxRows = await this.prisma.inbox.findMany({
      where: elevated ? { orgId: ORG_ID } : { teams: { some: { teamId: { in: userTeams } } } },
      include: { teams: true },
    });
    const inboxes: ViewItem[] = [];
    for (const i of inboxRows) {
      let groups: { id: string; title: string }[] | undefined;
      if (i.type === "whatsapp") {
        const gs = await this.prisma.conversation.findMany({
          where: { inboxId: i.id, channel: "whatsapp_group" },
          include: { contact: true },
          orderBy: { lastActivityAt: "desc" },
        });
        if (gs.length) groups = gs.map((g) => ({ id: g.id, title: g.contact.displayName }));
      }
      inboxes.push({
        key: `inbox:${i.id}`,
        title: i.name,
        count: await count(`inbox:${i.id}`),
        channel: i.type as ChannelType,
        handle: i.handle,
        groups,
      });
    }

    const labelRows = await this.prisma.label.findMany({ where: { orgId: ORG_ID }, orderBy: { name: "asc" } });
    const labels: ViewItem[] = [];
    for (const l of labelRows) {
      const c = await count(`label:${l.id}`);
      if (c > 0) labels.push({ key: `label:${l.id}`, title: l.name, count: c, color: l.color });
    }

    return { my, shared: { teams, inboxes, labels } };
  }

  async getConversation(id: string): Promise<ConversationWithMessages | undefined> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        ...convInclude,
        participants: { include: { contact: { include: { identities: true } } } },
      },
    });
    if (!row) return undefined;
    // Load only the most-recent page of messages (one extra row reveals whether
    // older history exists) — never the full lifetime thread.
    const latest = await this.prisma.message.findMany({
      where: { conversationId: id },
      include: { attachments: true },
      orderBy: { seq: "desc" },
      take: MESSAGES_PAGE_SIZE + 1,
    });
    const hasMoreMessages = latest.length > MESSAGES_PAGE_SIZE;
    const page = (hasMoreMessages ? latest.slice(0, MESSAGES_PAGE_SIZE) : latest).reverse();
    return {
      ...mapConversation(row),
      messages: page.map(mapMessage),
      hasMoreMessages,
      participants: row.participants.map(mapParticipant),
    };
  }

  async listMessages(
    conversationId: string,
    opts?: { before?: string; limit?: number },
  ): Promise<MessagePage> {
    const limit = pageLimit(opts?.limit, MESSAGES_PAGE_SIZE);
    const beforeSeq = opts?.before != null ? Number(opts.before) : undefined;
    const older = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(beforeSeq != null && Number.isFinite(beforeSeq) ? { seq: { lt: beforeSeq } } : {}),
      },
      include: { attachments: true },
      orderBy: { seq: "desc" },
      take: limit + 1,
    });
    const hasMore = older.length > limit;
    const page = (hasMore ? older.slice(0, limit) : older).reverse(); // ascending for prepend
    const oldest = page[0];
    return {
      items: page.map(mapMessage),
      nextCursor: hasMore && oldest ? String(oldest.seq) : null,
    };
  }

  async addMessage(
    conversationId: string,
    input: {
      body: string;
      bodyHtml?: string;
      internal: boolean;
      attachmentIds?: string[];
      quotedMsgId?: string;
      channel?: ChannelType;
      idempotencyKey?: string;
      deliveryMeta?: OutboundDeliveryMeta;
    },
    author: User,
  ): Promise<Message | undefined> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) return undefined;
    const seq = conv.seq + 1;
    // Claim staged uploads (attached in the composer, not yet tied to a message).
    const staged = input.attachmentIds?.length
      ? await this.prisma.attachment.findMany({
          where: { id: { in: input.attachmentIds }, messageId: null },
        })
      : [];
    const messageType = staged.length ? messageTypeForKind(staged[0].kind) : "text";
    const preview = input.body || previewForType(messageType);
    // Replying to an unclaimed chat takes ownership of it.
    const assignOnReply = !input.internal && !conv.assigneeUserId && conv.status !== "closed";
    // Replying to a snoozed conversation wakes it back into the active queue.
    const wakeSnooze = !input.internal && conv.status === "snoozed";
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          seq,
          direction: "out",
          authorType: "user",
          authorUserId: author.id,
          authorName: author.name,
          body: input.body,
          bodyHtml: input.bodyHtml ?? null,
          // A real reply starts queued and climbs the delivery ladder as the
          // channel confirms it (queued → sending → sent → delivered → read);
          // notes have no ladder.
          status: input.internal ? "sent" : "queued",
          internal: input.internal,
          messageType,
          channel: input.channel ?? null,
          quotedMsgId: input.quotedMsgId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          deliveryMeta: (input.deliveryMeta as Prisma.InputJsonValue) ?? undefined,
          ...(staged.length ? { attachments: { connect: staged.map((a) => ({ id: a.id })) } } : {}),
        },
        include: { attachments: true },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          seq,
          unread: false,
          unreadCount: 0,
          // Only a real (non-note) message advances the card's time + list order.
          ...(input.internal ? {} : { lastActivityAt: new Date(), preview }),
          ...(wakeSnooze ? { status: "open", snoozedUntil: null } : {}),
          ...(assignOnReply ? { assigneeUserId: author.id } : {}),
        },
      }),
    ]);
    return mapMessage(message);
  }

  async createUploadAttachment(_orgId: string, input: AttachmentInput): Promise<Attachment> {
    const row = await this.prisma.attachment.create({ data: toAttachmentCreate(input) });
    return mapAttachment(row);
  }

  async assign(
    conversationId: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
    byUserId?: string,
  ): Promise<Conversation | undefined> {
    // Assignment must NOT reorder the list or reset the card's time — only real
    // messages do that.
    const data: Prisma.ConversationUpdateInput = {};
    if (input.assigneeUserId !== undefined)
      data.assignee = input.assigneeUserId
        ? { connect: { id: input.assigneeUserId } }
        : { disconnect: true };
    if (input.assignedTeamId !== undefined)
      data.team = input.assignedTeamId ? { connect: { id: input.assignedTeamId } } : { disconnect: true };
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data,
        include: convInclude,
      });
      await this.prisma.assignmentEvent.create({
        data: {
          conversationId,
          toUserId: input.assigneeUserId ?? null,
          toTeamId: input.assignedTeamId ?? null,
          byUserId: byUserId ?? null,
        },
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async rerouteInboxConversations(inboxId: string): Promise<number> {
    const inbox = await this.prisma.inbox.findUnique({ where: { id: inboxId }, include: { teams: true } });
    if (!inbox) return 0;
    const teamIds = inbox.teams.map((t) => t.teamId);
    const valid = new Set(teamIds);
    const primary = teamIds[0] ?? null;
    const rows = await this.prisma.conversation.findMany({
      where: { inboxId, status: { in: ["open", "pending"] } },
      include: { contact: true },
    });
    let moved = 0;
    for (const c of rows) {
      // Leave chats already sitting on a team the channel still serves.
      if (c.assignedTeamId && valid.has(c.assignedTeamId)) continue;
      const ownerTeam = c.contact.ownerTeamId ?? null;
      const ownerUser = c.contact.ownerUserId ?? null;
      const teamId = ownerTeam ?? primary;
      const userId = ownerUser; // a pinned person keeps the chat; else it queues
      try {
        await this.prisma.conversation.update({
          where: { id: c.id },
          data: {
            team: teamId ? { connect: { id: teamId } } : { disconnect: true },
            assignee: userId ? { connect: { id: userId } } : { disconnect: true },
          },
        });
        moved++;
      } catch {
        // Skip a conversation that fails to update rather than aborting the batch.
      }
    }
    return moved;
  }

  async setStatus(conversationId: string, status: ConversationStatus): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status,
          ...(status === "closed" ? { unread: false, unreadCount: 0 } : {}),
          ...(status !== "snoozed" ? { snoozedUntil: null } : {}),
        },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async wakeSnoozed(conversationId: string): Promise<Conversation | undefined> {
    const row = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: convInclude });
    if (!row) return undefined;
    if (row.status !== "snoozed") return mapConversation(row);
    // Wake into the active queue but KEEP snoozedUntil as the "back from Later"
    // marker (cleared when the agent opens it — see clearUnread).
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "open" },
      include: convInclude,
    });
    return mapConversation(updated);
  }

  async setPriority(conversationId: string, priority: Priority): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { priority },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async setSubject(conversationId: string, subject: string | null): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { subject },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async setInviteLink(conversationId: string, inviteLink: string): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { inviteLink },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async setConversationInbox(conversationId: string, inboxId: string): Promise<Conversation | undefined> {
    const cur = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { inboxId: true },
    });
    if (!cur || cur.inboxId === inboxId) return undefined; // unknown or already there
    const row = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { inboxId },
      include: convInclude,
    });
    return mapConversation(row);
  }

  async setConversationChannelRef(
    conversationId: string,
    channelRef: string,
  ): Promise<Conversation | undefined> {
    const cur = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channelRef: true },
    });
    if (!cur || cur.channelRef === channelRef) return undefined; // unknown or unchanged
    const row = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { channelRef },
      include: convInclude,
    });
    return mapConversation(row);
  }

  async setSla(conversationId: string, dueAt: string | null): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { slaDueAt: dueAt ? new Date(dueAt) : null },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async snooze(conversationId: string, until: string): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "snoozed", snoozedUntil: new Date(until), unread: false, unreadCount: 0 },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async listDueSnoozed(): Promise<Conversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { status: "snoozed", snoozedUntil: { lte: new Date() } },
      include: convInclude,
      orderBy: { snoozedUntil: "asc" },
    });
    return rows.map(mapConversation);
  }

  async createNotification(input: {
    userId: string;
    type: Notification["type"];
    title: string;
    body?: string;
    conversationId?: string | null;
  }): Promise<Notification> {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? "",
        conversationId: input.conversationId ?? null,
      },
    });
    return mapNotification(row);
  }

  async listNotifications(userId: string, limit = 50): Promise<Notification[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(mapNotification);
  }

  async markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, ...(ids ? { id: { in: ids } } : {}) },
      data: { read: true },
    });
  }

  async setMessageChannelId(messageId: string, channelMsgId: string): Promise<void> {
    try {
      await this.prisma.message.update({ where: { id: messageId }, data: { channelMsgId } });
    } catch {
      /* message gone — nothing to reconcile */
    }
  }

  /* ---- durable outbound delivery ---- */

  async getOutboundMessage(messageId: string): Promise<OutboundMessageRef | undefined> {
    const m = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        status: true,
        channelMsgId: true,
        internal: true,
        deliveryMeta: true,
      },
    });
    if (!m) return undefined;
    return {
      messageId: m.id,
      conversationId: m.conversationId,
      status: m.status as MessageStatus,
      channelMsgId: m.channelMsgId ?? undefined,
      internal: m.internal,
      deliveryMeta: (m.deliveryMeta as OutboundDeliveryMeta | null) ?? undefined,
    };
  }

  async markMessageSending(messageId: string): Promise<MessageStatusChange | undefined> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return undefined;
    const current = msg.status as MessageStatus;
    // Only a queued message (or one already mid-attempt on a retry) enters "sending".
    if (current !== "queued" && current !== "sending") return undefined;
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { status: "sending", attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  async markMessageSent(
    messageId: string,
    channelMsgId?: string,
  ): Promise<MessageStatusChange | undefined> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return undefined;
    const current = msg.status as MessageStatus;
    if (current === "failed") return undefined; // never resurrect a failed message
    const data: Prisma.MessageUpdateInput = {
      providerError: null,
      providerErrorCode: null,
      failureReason: null,
    };
    // Set the channel id once so out-of-order status webhooks can reconcile.
    if (channelMsgId && !msg.channelMsgId) data.channelMsgId = channelMsgId;
    // Advance to "sent" unless a delivered/read webhook already beat us there.
    if (canAdvanceStatus(current, "sent")) data.status = "sent";
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data,
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  async recordSendFailure(
    messageId: string,
    info: { error?: string; code?: string; permanent: boolean; reason?: string },
  ): Promise<MessageStatusChange | undefined> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return undefined;
    const current = msg.status as MessageStatus;
    const data: Prisma.MessageUpdateInput = {
      providerError: info.error ? info.error.slice(0, 500) : null,
      providerErrorCode: info.code ?? null,
    };
    // A permanent failure flips the message to failed — but only if the ladder
    // allows it (a delivered/read message stays; we just keep the diagnostics).
    if (info.permanent && canAdvanceStatus(current, "failed")) {
      data.status = "failed";
      data.failureReason = info.reason ?? "Message could not be delivered";
    }
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data,
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  async listStuckOutbound(
    olderThanMs: number,
  ): Promise<Array<{ messageId: string; conversationId: string; idempotencyKey?: string }>> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.prisma.message.findMany({
      where: {
        direction: "out",
        internal: false,
        status: { in: ["queued", "sending"] },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: cutoff } }],
      },
      select: { id: true, conversationId: true, idempotencyKey: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    return rows.map((r) => ({
      messageId: r.id,
      conversationId: r.conversationId,
      idempotencyKey: r.idempotencyKey ?? undefined,
    }));
  }

  async resetMessageForRetry(
    messageId: string,
    idempotencyKey: string,
  ): Promise<MessageStatusChange | undefined> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return undefined;
    // Only a failed outbound message may be manually retried.
    if (msg.direction !== "out" || msg.internal || (msg.status as MessageStatus) !== "failed") {
      return undefined;
    }
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: "queued",
        failureReason: null,
        providerError: null,
        providerErrorCode: null,
        idempotencyKey,
      },
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  /* ---- ingestion ---- */

  async getInboxByWhatsAppPhoneId(phoneNumberId: string): Promise<Inbox | undefined> {
    const rows = await this.prisma.inbox.findMany({
      where: { orgId: ORG_ID, type: { in: ["whatsapp", "whatsapp_group"] } },
      include: { teams: true },
    });
    // Deterministic: the inbox whose configured number matches this one.
    const byConfig = rows.find(
      (i) => (i.channelConfig as { phoneNumberId?: string } | null)?.phoneNumberId === phoneNumberId,
    );
    if (byConfig) return mapInbox(byConfig);
    // Single-number env fallback: the globally-configured number maps to the one
    // WhatsApp inbox that has no per-inbox number of its own. Still deterministic
    // (keyed on the incoming number equalling env) — never an arbitrary inbox.
    if (env.whatsapp.phoneNumberId && env.whatsapp.phoneNumberId === phoneNumberId) {
      const envInbox = rows.find(
        (i) => !(i.channelConfig as { phoneNumberId?: string } | null)?.phoneNumberId,
      );
      if (envInbox) return mapInbox(envInbox);
    }
    return undefined; // no deterministic match — caller records a diagnostic
  }

  async getInboxByEmailAddress(address: string): Promise<Inbox | undefined> {
    const rows = await this.prisma.inbox.findMany({
      where: { orgId: ORG_ID, type: "email" },
      include: { teams: true },
    });
    const a = address.trim().toLowerCase();
    // Deterministic match on the inbox address only — never fall back to an
    // arbitrary inbox for mail addressed to an account we don't manage.
    const match = rows.find((i) => i.handle.toLowerCase() === a);
    return match ? mapInbox(match) : undefined;
  }

  async recordWebhookDiagnostic(input: {
    channel: string;
    kind: string;
    reference?: string;
    detail?: string;
  }): Promise<void> {
    await this.prisma.webhookDiagnostic.create({
      data: {
        channel: input.channel,
        kind: input.kind,
        reference: input.reference ?? null,
        detail: input.detail ?? null,
      },
    });
  }

  async listWebhookDiagnostics(limit = 100): Promise<WebhookDiagnostic[]> {
    const rows = await this.prisma.webhookDiagnostic.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      kind: r.kind,
      reference: r.reference ?? undefined,
      detail: r.detail ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async findConversationByMessageChannelIds(channelMsgIds: string[]): Promise<string | undefined> {
    if (!channelMsgIds.length) return undefined;
    const msg = await this.prisma.message.findFirst({
      where: { channelMsgId: { in: channelMsgIds } },
      orderBy: { createdAt: "desc" },
    });
    return msg?.conversationId;
  }

  async upsertContactByIdentity(params: {
    orgId: string;
    kind: "phone" | "email" | "wa_id";
    value: string;
    displayName: string;
    company?: string;
    avatarColor?: string;
  }): Promise<Contact> {
    // A phone number can arrive as either `phone` or `wa_id` — match across both
    // so we don't fork one customer into two contacts (mirrors setIdentity).
    const matchKinds = params.kind === "email" ? ["email"] : ["phone", "wa_id"];
    // Match on the CANONICAL value (scoped to the org): "+44 7911…", "07911…"
    // and WhatsApp's "447911…" all resolve to one contact.
    const normalized = normalizeIdentity(params.kind, params.value)?.normalized ?? params.value;
    const idents = await this.prisma.contactIdentity.findMany({
      where: { orgId: params.orgId, kind: { in: matchKinds }, normalizedValue: normalized },
      include: { contact: { include: { identities: true } } },
    });
    if (idents.length) {
      const byId = new Map<string, (typeof idents)[number]["contact"]>();
      for (const i of idents) if (!byId.has(i.contactId)) byId.set(i.contactId, i.contact);
      const contacts = [...byId.values()];
      if (contacts.length > 1) {
        // Auto-merge: several contacts share this messaging identity. An inbound
        // from it proves they're the same customer, so consolidate (oldest wins).
        const winner = contacts.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
        return this.mergeContacts({ winnerId: winner.id, loserIds: contacts.filter((c) => c.id !== winner.id).map((c) => c.id) });
      }
      return mapContact(contacts[0]);
    }

    try {
      const contact = await this.prisma.contact.create({
        data: {
          orgId: params.orgId,
          displayName: params.displayName,
          company: params.company,
          avatarColor: params.avatarColor,
          identities: {
            create: [{ orgId: params.orgId, kind: params.kind, value: params.value, normalizedValue: normalized }],
          },
        },
        include: { identities: true },
      });
      return mapContact(contact);
    } catch {
      // Concurrent webhook raced us to the same identity (global [kind,value]
      // unique) — re-fetch and return the contact that won.
      const raced = await this.prisma.contactIdentity.findFirst({
        where: { orgId: params.orgId, kind: { in: matchKinds }, normalizedValue: normalized },
        include: { contact: { include: { identities: true } } },
      });
      if (raced) return mapContact(raced.contact);
      throw new Error("Failed to create or resolve contact identity");
    }
  }

  async findOrCreateOpenConversation(params: {
    orgId: string;
    inboxId: string;
    contact: Contact;
    channel: ChannelType;
    subject?: string;
    assigneeUserId?: string | null;
    assignedTeamId?: string | null;
  }): Promise<{ conversation: Conversation; created: boolean }> {
    // Unify by CONTACT across channels while a thread is open: an inbound on any
    // channel (or an agent reaching out on another) threads into the customer's
    // one open conversation. Once it's closed, the next message starts a new chat.
    const open = await this.prisma.conversation.findFirst({
      where: { orgId: params.orgId, contactId: params.contact.id, status: { in: ["open", "pending"] } },
      include: convInclude,
      orderBy: { lastActivityAt: "desc" },
    });
    if (open) return { conversation: mapConversation(open), created: false };

    const created = await this.prisma.conversation.create({
      data: {
        orgId: params.orgId,
        inboxId: params.inboxId,
        contactId: params.contact.id,
        channel: params.channel,
        subject: params.subject,
        status: "open",
        assigneeUserId: params.assigneeUserId ?? null,
        assignedTeamId: params.assignedTeamId ?? null,
        priority: "normal",
        unread: true,
        seq: 0,
        preview: "",
      },
      include: convInclude,
    });
    return { conversation: mapConversation(created), created: true };
  }

  async appendInboundMessage(
    conversationId: string,
    input: AppendInboundInput,
  ): Promise<Message | undefined> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) return undefined;
    const seq = conv.seq + 1;
    // A new customer message on a closed or snoozed chat wakes it back up.
    const wasClosed = conv.status === "closed";
    const reopen = wasClosed || conv.status === "snoozed";
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          seq,
          direction: "in",
          authorType: "contact",
          authorName: input.authorName,
          body: input.body,
          bodyHtml: input.bodyHtml ?? null,
          status: "delivered",
          channelMsgId: input.channelMsgId,
          channel: input.channel ?? null,
          messageType: input.messageType ?? "text",
          quotedMsgId: input.quotedMsgId ?? null,
          ...(input.attachments?.length
            ? { attachments: { create: input.attachments.map(toAttachmentCreate) } }
            : {}),
        },
        include: { attachments: true },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          seq,
          lastActivityAt: new Date(),
          // Only a WhatsApp inbound (re)opens the WhatsApp 24-hour window — an
          // email arriving in a cross-channel thread must not extend it.
          ...(isWaChannel(input.channel ?? (conv.channel as ChannelType))
            ? { lastInboundAt: new Date() }
            : {}),
          unread: true,
          unreadCount: { increment: 1 },
          preview: input.body || previewForType(input.messageType),
          ...(reopen ? { status: "open", snoozedUntil: null, ...(wasClosed ? { assigneeUserId: null } : {}) } : {}),
        },
      }),
    ]);
    return mapMessage(message);
  }

  async getAttachment(id: string): Promise<StoredAttachmentRef | undefined> {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    return a ? { storageKey: a.r2Key, mime: a.mime, filename: a.filename } : undefined;
  }

  async getAttachmentAccess(
    id: string,
  ): Promise<{ storageKey: string; mime: string; filename: string; orgId?: string } | undefined> {
    const a = await this.prisma.attachment.findUnique({
      where: { id },
      select: {
        r2Key: true,
        mime: true,
        filename: true,
        message: { select: { conversation: { select: { orgId: true } } } },
      },
    });
    if (!a) return undefined;
    return {
      storageKey: a.r2Key,
      mime: a.mime,
      filename: a.filename,
      orgId: a.message?.conversation.orgId,
    };
  }

  async updateMessageStatusByChannelId(
    channelMsgId: string,
    status: MessageStatus,
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    const msg = await this.prisma.message.findFirst({ where: { channelMsgId } });
    if (!msg) return undefined;
    // Never regress the ladder (out-of-order/duplicate webhooks are common).
    if (!canAdvanceStatus(msg.status as MessageStatus, status)) return undefined;
    const updated = await this.prisma.message.update({
      where: { id: msg.id },
      data: { status },
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  async clearUnread(conversationId: string): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { unread: false, unreadCount: 0 },
        include: convInclude,
      });
      // Opening a conversation that woke from Later acknowledges it → drop the
      // "back from Later" marker so the badge disappears.
      if (row.status !== "snoozed" && row.snoozedUntil) {
        const cleared = await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { snoozedUntil: null },
          include: convInclude,
        });
        return mapConversation(cleared);
      }
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async markUnread(conversationId: string): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { unread: true, unreadCount: 0 }, // manual mark → empty dot
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  /* ---- labels ---- */
  async listLabels(orgId: string): Promise<Label[]> {
    const rows = await this.prisma.label.findMany({ where: { orgId }, orderBy: { name: "asc" } });
    return rows.map((l) => ({ id: l.id, name: l.name, color: l.color }));
  }

  async createLabel(input: { orgId: string; name: string; color: string }): Promise<Label> {
    const name = input.name.trim();
    // Names are unique per org — reuse an existing one rather than error.
    const row = await this.prisma.label.upsert({
      where: { orgId_name: { orgId: input.orgId, name } },
      update: { color: input.color },
      create: { orgId: input.orgId, name, color: input.color },
    });
    return { id: row.id, name: row.name, color: row.color };
  }

  async updateLabel(id: string, patch: { name?: string; color?: string }): Promise<Label | undefined> {
    try {
      const row = await this.prisma.label.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
        },
      });
      return { id: row.id, name: row.name, color: row.color };
    } catch {
      return undefined;
    }
  }

  async deleteLabel(id: string): Promise<void> {
    // Remove the join rows first, then the label (no cascade in the schema).
    await this.prisma.conversationLabel.deleteMany({ where: { labelId: id } });
    await this.prisma.label.delete({ where: { id } }).catch(() => undefined);
  }

  async setConversationLabels(conversationId: string, labelIds: string[]): Promise<Conversation | undefined> {
    const unique = [...new Set(labelIds)];
    try {
      await this.prisma.$transaction([
        this.prisma.conversationLabel.deleteMany({ where: { conversationId } }),
        ...(unique.length
          ? [
              this.prisma.conversationLabel.createMany({
                data: unique.map((labelId) => ({ conversationId, labelId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
      const row = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: convInclude });
      return row ? mapConversation(row) : undefined;
    } catch {
      return undefined;
    }
  }

  async getMessageRefByChannelId(
    channelMsgId: string,
  ): Promise<{ id: string; conversationId: string } | undefined> {
    const m = await this.prisma.message.findFirst({
      where: { channelMsgId },
      select: { id: true, conversationId: true },
      orderBy: { createdAt: "desc" },
    });
    return m ?? undefined;
  }

  async failMessage(
    messageId: string,
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return undefined;
    if (!canAdvanceStatus(msg.status as MessageStatus, "failed")) return undefined;
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { status: "failed" },
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  async reactToMessage(
    messageId: string,
    emoji: string,
    by: "contact" | "user",
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m) return undefined;
    // At most one reaction per participant: drop theirs, then add the new one.
    const kept = parseReactions(m.reactions).filter((r) => r.by !== by);
    const next = emoji.trim() ? [...kept, { emoji: emoji.trim(), by }] : kept;
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { reactions: next as unknown as Prisma.InputJsonValue },
      include: { attachments: true },
    });
    return { conversationId: updated.conversationId, message: mapMessage(updated) };
  }

  /* ---- groups ---- */

  async findConversationByChannelRef(channelRef: string): Promise<string | undefined> {
    const c = await this.prisma.conversation.findFirst({ where: { channelRef }, select: { id: true } });
    return c?.id;
  }

  async createContact(params: {
    orgId: string;
    displayName: string;
    avatarColor?: string;
    company?: string;
    phone?: string;
    email?: string;
    tags?: string[];
    ownerUserId?: string | null;
    ownerTeamId?: string | null;
  }): Promise<{ contact: Contact; created: boolean }> {
    // Get-or-create: if the phone or email already resolves to a contact in this
    // org, return that one instead of forking a duplicate.
    const phone = params.phone ? normalizeIdentity("phone", params.phone) : null;
    const email = params.email ? normalizeIdentity("email", params.email) : null;
    const or: Prisma.ContactIdentityWhereInput[] = [];
    if (phone) or.push({ kind: { in: ["phone", "wa_id"] }, normalizedValue: phone.normalized });
    if (email) or.push({ kind: "email", normalizedValue: email.normalized });
    if (or.length) {
      const hit = await this.prisma.contactIdentity.findFirst({
        where: { orgId: params.orgId, OR: or },
        include: { contact: { include: { identities: true } } },
      });
      if (hit) return { contact: mapContact(hit.contact), created: false };
    }

    const count = await this.prisma.contact.count({ where: { orgId: params.orgId } });
    const created = await this.prisma.contact.create({
      data: {
        orgId: params.orgId,
        displayName: params.displayName,
        company: params.company ?? null,
        avatarColor: params.avatarColor ?? AVATAR_PALETTE[count % AVATAR_PALETTE.length],
        tags: params.tags ?? [],
        ownerUserId: params.ownerUserId ?? null,
        ownerTeamId: params.ownerTeamId ?? null,
      },
    });
    await this.setIdentity(created.id, params.orgId, ["phone", "wa_id"], "phone", params.phone);
    await this.setIdentity(created.id, params.orgId, ["email"], "email", params.email);
    const full = await this.prisma.contact.findUnique({
      where: { id: created.id },
      include: { identities: true },
    });
    return { contact: mapContact(full!), created: true };
  }

  /**
   * Backfill normalizedValue (and orgId) for identity rows that don't have them
   * yet — a one-time pass after the migration, idempotent on later boots. Existing
   * contacts must carry a normalized value or an inbound message would fail to
   * match them and fork a duplicate.
   */
  async backfillIdentityNormalization(): Promise<{ updated: number }> {
    const rows = await this.prisma.contactIdentity.findMany({
      where: { OR: [{ normalizedValue: null }, { orgId: null }] },
      include: { contact: { select: { orgId: true } } },
    });
    let updated = 0;
    for (const r of rows) {
      const normalized = normalizeIdentity(r.kind as IdentityKind, r.value)?.normalized ?? r.value;
      await this.prisma.contactIdentity
        .update({
          where: { id: r.id },
          data: { normalizedValue: normalized, orgId: r.orgId ?? r.contact.orgId },
        })
        .catch(() => {});
      updated++;
    }
    return { updated };
  }

  /* ---- customers directory ---- */

  /**
   * Reconcile a single identity (phone/email) on a contact. `matchKinds` are the
   * kinds that count as "the same slot" when looking for an existing row (phone
   * matches a legacy wa_id too); `writeKind` is used only when creating a fresh
   * one. `undefined` value = field not supplied (leave as-is); empty = clear it.
   */
  private async setIdentity(
    contactId: string,
    orgId: string,
    matchKinds: string[],
    writeKind: string,
    value: string | undefined,
  ): Promise<void> {
    if (value === undefined) return;
    const existing = await this.prisma.contactIdentity.findFirst({
      where: { contactId, kind: { in: matchKinds } },
    });
    const v = value.trim();
    if (!v) {
      if (existing) await this.prisma.contactIdentity.delete({ where: { id: existing.id } }).catch(() => {});
      return;
    }
    const normalized = normalizeIdentity(writeKind as IdentityKind, v)?.normalized ?? v;
    try {
      if (existing) {
        if (existing.value !== v || existing.normalizedValue !== normalized || existing.orgId !== orgId)
          await this.prisma.contactIdentity.update({
            where: { id: existing.id },
            data: { value: v, normalizedValue: normalized, orgId },
          });
      } else {
        await this.prisma.contactIdentity.create({
          data: { contactId, orgId, kind: writeKind, value: v, normalizedValue: normalized },
        });
      }
    } catch {
      /* [kind,value] is globally unique — another contact already owns it; skip */
    }
  }

  async listContacts(): Promise<Contact[]> {
    const rows = await this.prisma.contact.findMany({
      where: { orgId: ORG_ID },
      include: { identities: true },
    });
    return rows.map(mapContact).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async findDuplicateContacts(): Promise<ContactDuplicateGroup[]> {
    return groupDuplicateContacts(await this.listContacts());
  }

  async mergeContacts(params: { winnerId: string; loserIds: string[] }): Promise<Contact> {
    const loserIds = [...new Set(params.loserIds)].filter((id) => id !== params.winnerId);
    if (loserIds.length) {
      await this.prisma.$transaction(async (tx) => {
        const winner = await tx.contact.findUnique({ where: { id: params.winnerId }, include: { identities: true } });
        if (!winner) throw new Error("Winner contact not found");
        const losers = await tx.contact.findMany({ where: { id: { in: loserIds } }, include: { identities: true } });
        for (const l of losers) {
          if (l.orgId !== winner.orgId) throw new Error("Cannot merge contacts across organisations");
        }

        // Conversations (and their messages/notes/labels) move to the winner.
        await tx.conversation.updateMany({ where: { contactId: { in: loserIds } }, data: { contactId: params.winnerId } });

        // Participants move too, but a conversation can list a contact only once
        // (@@unique conversationId+contactId) — drop the loser's row if the
        // winner is already a participant there.
        const winnerConvs = new Set(
          (await tx.participant.findMany({ where: { contactId: params.winnerId }, select: { conversationId: true } })).map((p) => p.conversationId),
        );
        for (const p of await tx.participant.findMany({ where: { contactId: { in: loserIds } } })) {
          if (winnerConvs.has(p.conversationId)) await tx.participant.delete({ where: { id: p.id } });
          else {
            await tx.participant.update({ where: { id: p.id }, data: { contactId: params.winnerId } });
            winnerConvs.add(p.conversationId);
          }
        }

        // Identities move too, honouring the global @@unique(kind,value): drop a
        // loser identity the winner already carries verbatim.
        const winnerKeys = new Set(winner.identities.map((i) => `${i.kind}::${i.value}`));
        for (const l of losers) {
          for (const idn of l.identities) {
            const key = `${idn.kind}::${idn.value}`;
            if (winnerKeys.has(key)) await tx.contactIdentity.delete({ where: { id: idn.id } });
            else {
              await tx.contactIdentity.update({ where: { id: idn.id }, data: { contactId: params.winnerId, orgId: winner.orgId } });
              winnerKeys.add(key);
            }
          }
        }

        // Fill the winner's blank fields from the losers and union their tags.
        const pick = (get: (c: (typeof losers)[number]) => string | null): string | null => {
          for (const l of losers) { const v = get(l); if (v) return v; }
          return null;
        };
        await tx.contact.update({
          where: { id: params.winnerId },
          data: {
            company: winner.company ?? pick((l) => l.company),
            avatarColor: winner.avatarColor ?? pick((l) => l.avatarColor),
            ownerUserId: winner.ownerUserId ?? pick((l) => l.ownerUserId),
            ownerTeamId: winner.ownerTeamId ?? pick((l) => l.ownerTeamId),
            tags: [...new Set([...(winner.tags ?? []), ...losers.flatMap((l) => l.tags ?? [])])],
          },
        });

        await tx.contact.deleteMany({ where: { id: { in: loserIds } } });
      });
    }
    const merged = await this.prisma.contact.findUnique({ where: { id: params.winnerId }, include: { identities: true } });
    if (!merged) throw new Error("Winner contact not found");
    return mapContact(merged);
  }

  async getContactWithConversations(id: string): Promise<ContactWithConversations | undefined> {
    const contact = await this.prisma.contact.findUnique({ where: { id }, include: { identities: true } });
    if (!contact) return undefined;
    const convs = await this.prisma.conversation.findMany({
      where: { contactId: id },
      include: convInclude,
      orderBy: { lastActivityAt: "desc" },
    });
    return { ...mapContact(contact), conversations: convs.map(mapConversation) };
  }

  async updateContact(
    id: string,
    params: {
      displayName?: string;
      company?: string;
      phone?: string;
      email?: string;
      tags?: string[];
      ownerUserId?: string | null;
      ownerTeamId?: string | null;
      blocked?: boolean;
    },
  ): Promise<Contact | undefined> {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) return undefined;
    const data: Prisma.ContactUpdateInput = {};
    if (params.displayName !== undefined) data.displayName = params.displayName;
    if (params.company !== undefined) data.company = params.company || null;
    if (params.tags !== undefined) data.tags = params.tags;
    if (params.ownerUserId !== undefined) data.ownerUserId = params.ownerUserId ?? null;
    if (params.ownerTeamId !== undefined) data.ownerTeamId = params.ownerTeamId ?? null;
    if (params.blocked !== undefined) data.blocked = params.blocked;
    if (Object.keys(data).length) await this.prisma.contact.update({ where: { id }, data });
    await this.setIdentity(id, existing.orgId, ["phone", "wa_id"], "phone", params.phone);
    await this.setIdentity(id, existing.orgId, ["email"], "email", params.email);
    const full = await this.prisma.contact.findUnique({ where: { id }, include: { identities: true } });
    return full ? mapContact(full) : undefined;
  }

  async deleteContact(id: string): Promise<void> {
    // The contact's own 1:1 conversations and everything hanging off them, then
    // their group memberships + identities, then the contact — in one transaction
    // (the FK relations aren't ON DELETE CASCADE, so children go first).
    const convs = await this.prisma.conversation.findMany({ where: { contactId: id }, select: { id: true } });
    const convIds = convs.map((c) => c.id);
    await this.prisma.$transaction(async (tx) => {
      if (convIds.length) {
        const msgs = await tx.message.findMany({ where: { conversationId: { in: convIds } }, select: { id: true } });
        const msgIds = msgs.map((m) => m.id);
        if (msgIds.length) await tx.attachment.deleteMany({ where: { messageId: { in: msgIds } } });
        await tx.message.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.note.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.conversationLabel.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.assignmentEvent.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.participant.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.conversation.deleteMany({ where: { id: { in: convIds } } });
      }
      await tx.participant.deleteMany({ where: { contactId: id } });
      await tx.contactIdentity.deleteMany({ where: { contactId: id } });
      await tx.contact.delete({ where: { id } });
    });
  }

  async createGroupConversation(params: {
    orgId: string;
    inboxId: string;
    contact: Contact;
    subject: string;
    channelRef: string;
    inviteLink: string;
    memberContacts: Contact[];
    assigneeUserId?: string | null;
    assignedTeamId?: string | null;
  }): Promise<Conversation> {
    const conv = await this.prisma.conversation.create({
      data: {
        orgId: params.orgId,
        inboxId: params.inboxId,
        contactId: params.contact.id,
        channel: "whatsapp_group",
        subject: params.subject,
        channelRef: params.channelRef,
        inviteLink: params.inviteLink,
        status: "open",
        assigneeUserId: params.assigneeUserId ?? null,
        assignedTeamId: params.assignedTeamId ?? null,
        priority: "normal",
        unread: false,
        seq: 0,
        preview: `Group created · ${params.memberContacts.length} members`,
        participants: { create: params.memberContacts.map((ct) => ({ contactId: ct.id, role: "member" })) },
      },
      include: convInclude,
    });
    return mapConversation(conv);
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    const rows = await this.prisma.participant.findMany({
      where: { conversationId },
      include: { contact: { include: { identities: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return rows.map(mapParticipant);
  }

  async countParticipants(conversationId: string): Promise<number> {
    return this.prisma.participant.count({ where: { conversationId } });
  }

  async addParticipant(conversationId: string, contact: Contact, role: ParticipantRole = "member"): Promise<Participant> {
    const existing = await this.prisma.participant.findUnique({
      where: { conversationId_contactId: { conversationId, contactId: contact.id } },
      include: { contact: { include: { identities: true } } },
    });
    if (existing) return mapParticipant(existing);
    const row = await this.prisma.participant.create({
      data: { conversationId, contactId: contact.id, role },
      include: { contact: { include: { identities: true } } },
    });
    return mapParticipant(row);
  }

  async removeParticipant(conversationId: string, contactId: string): Promise<void> {
    await this.prisma.participant.deleteMany({ where: { conversationId, contactId } });
  }
}

/** AttachmentInput → Prisma nested-create row (storage key stored as r2Key). */
function toAttachmentCreate(a: AttachmentInput): Prisma.AttachmentCreateWithoutMessageInput {
  return {
    r2Key: a.storageKey,
    mime: a.mime,
    size: a.size,
    filename: a.filename,
    kind: a.kind,
    durationMs: a.durationMs ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    waveform: a.waveform ? JSON.stringify(a.waveform) : null,
  };
}

