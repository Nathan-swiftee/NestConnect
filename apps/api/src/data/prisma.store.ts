import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import type {
  Attachment,
  ChannelType,
  Contact,
  ContactWithConversations,
  Conversation,
  ConversationStatus,
  ConversationWithMessages,
  CreateTemplateInput,
  Inbox,
  Member,
  Message,
  MessageStatus,
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
import { env } from "../config/env";
import { DEMO_USER_ID, ORG_ID } from "./fixtures";
import {
  mapAttachment,
  mapContact,
  mapConversation,
  mapConversationWithMessages,
  mapInbox,
  mapMessage,
  mapParticipant,
  mapTeam,
  mapTemplate,
  mapUser,
  messageTypeForKind,
  previewForType,
} from "./mappers";
import { PrismaService } from "./prisma.service";
import {
  Store,
  type AppendInboundInput,
  type AttachmentInput,
  type SidebarViews,
  type StoredAttachmentRef,
  type ViewItem,
} from "./store";

const convInclude = {
  contact: { include: { identities: true } },
  labels: { include: { label: true } },
} satisfies Prisma.ConversationInclude;

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
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  get demoUserId(): string {
    return DEMO_USER_ID;
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
        channelConfig: params.channelConfig ?? undefined,
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
    const mergedConfig =
      params.channelConfig !== undefined
        ? { ...((existing.channelConfig as Record<string, string> | null) ?? {}), ...params.channelConfig }
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
    return (row?.channelConfig as Record<string, string> | null) ?? undefined;
  }

  async getAppSetting(orgId: string, key: string): Promise<string | undefined> {
    const row = await this.prisma.appSetting.findUnique({
      where: { orgId_key: { orgId, key } },
    });
    return row?.value ?? undefined;
  }

  async setAppSetting(orgId: string, key: string, value: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { orgId_key: { orgId, key } },
      create: { orgId, key, value },
      update: { value },
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
    const row = await this.prisma.template.upsert({
      where: { orgId_name_language: { orgId, name: input.name, language: input.language } },
      create: {
        orgId,
        name: input.name,
        category: input.category,
        language: input.language,
        body: input.body,
        approvalStatus: input.approvalStatus,
      },
      update: {
        category: input.category,
        body: input.body,
        approvalStatus: input.approvalStatus,
      },
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
  }): Promise<User> {
    const u = await this.prisma.user.create({
      data: {
        orgId: params.orgId,
        name: params.name,
        email: params.email,
        role: params.role,
        passwordHash: bcrypt.hashSync(env.auth.devPassword, 8),
        memberships: { create: params.teamIds.map((teamId) => ({ teamId })) },
      },
    });
    return mapUser(u);
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
    return { id: "__none__" };
  }

  async listConversations(view: string, userId: string): Promise<Conversation[]> {
    const userTeams = await this.teamsForUser(userId);
    const token = await this.mentionToken(userId);
    const rows = await this.prisma.conversation.findMany({
      where: this.buildWhere(view, userId, userTeams, token),
      include: convInclude,
      orderBy: { lastActivityAt: "desc" },
    });
    return rows.map(mapConversation);
  }

  async views(userId: string): Promise<SidebarViews> {
    const userTeams = await this.teamsForUser(userId);
    const token = await this.mentionToken(userId);
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
      where: { id: { in: userTeams } },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    const teams: ViewItem[] = [];
    for (const t of teamRows) {
      teams.push({ key: `team:${t.id}`, title: t.name, count: await count(`team:${t.id}`) });
    }

    const inboxRows = await this.prisma.inbox.findMany({
      where: { teams: { some: { teamId: { in: userTeams } } } },
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

    return { my, shared: { teams, inboxes } };
  }

  async getConversation(id: string): Promise<ConversationWithMessages | undefined> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        ...convInclude,
        messages: { include: { attachments: true } },
        participants: { include: { contact: { include: { identities: true } } } },
      },
    });
    return row ? mapConversationWithMessages(row) : undefined;
  }

  async addMessage(
    conversationId: string,
    input: { body: string; internal: boolean; attachmentIds?: string[] },
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
          status: "sent",
          internal: input.internal,
          messageType,
          ...(staged.length ? { attachments: { connect: staged.map((a) => ({ id: a.id })) } } : {}),
        },
        include: { attachments: true },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          seq,
          lastActivityAt: new Date(),
          unread: false,
          unreadCount: 0,
          ...(input.internal ? {} : { preview }),
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
    const data: Prisma.ConversationUpdateInput = { lastActivityAt: new Date() };
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

  async setStatus(conversationId: string, status: ConversationStatus): Promise<Conversation | undefined> {
    try {
      const row = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status,
          lastActivityAt: new Date(),
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
        data: { status: "snoozed", snoozedUntil: new Date(until), unread: false, unreadCount: 0, lastActivityAt: new Date() },
        include: convInclude,
      });
      return mapConversation(row);
    } catch {
      return undefined;
    }
  }

  async setMessageChannelId(messageId: string, channelMsgId: string): Promise<void> {
    try {
      await this.prisma.message.update({ where: { id: messageId }, data: { channelMsgId } });
    } catch {
      /* message gone — nothing to reconcile */
    }
  }

  /* ---- ingestion ---- */

  async getInboxByWhatsAppPhoneId(phoneNumberId: string): Promise<Inbox | undefined> {
    const rows = await this.prisma.inbox.findMany({
      where: { orgId: ORG_ID, type: { in: ["whatsapp", "whatsapp_group"] } },
      include: { teams: true },
    });
    const byConfig = rows.find(
      (i) => (i.channelConfig as { phoneNumberId?: string } | null)?.phoneNumberId === phoneNumberId,
    );
    const target = byConfig ?? rows.find((i) => i.type === "whatsapp") ?? rows[0];
    return target ? mapInbox(target) : undefined;
  }

  async getInboxByEmailAddress(address: string): Promise<Inbox | undefined> {
    const rows = await this.prisma.inbox.findMany({
      where: { orgId: ORG_ID, type: "email" },
      include: { teams: true },
    });
    const a = address.trim().toLowerCase();
    const match = rows.find((i) => i.handle.toLowerCase() === a) ?? rows[0];
    return match ? mapInbox(match) : undefined;
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
    const ident = await this.prisma.contactIdentity.findUnique({
      where: { kind_value: { kind: params.kind, value: params.value } },
      include: { contact: { include: { identities: true } } },
    });
    if (ident) return mapContact(ident.contact);

    const contact = await this.prisma.contact.create({
      data: {
        orgId: params.orgId,
        displayName: params.displayName,
        company: params.company,
        avatarColor: params.avatarColor,
        identities: { create: [{ kind: params.kind, value: params.value }] },
      },
      include: { identities: true },
    });
    return mapContact(contact);
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
    const open = await this.prisma.conversation.findFirst({
      where: { inboxId: params.inboxId, contactId: params.contact.id, status: { in: ["open", "pending"] } },
      include: convInclude,
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
          status: "delivered",
          channelMsgId: input.channelMsgId,
          messageType: input.messageType ?? "text",
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
          // An inbound message (re)opens the WhatsApp 24-hour window.
          lastInboundAt: new Date(),
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

  async updateMessageStatusByChannelId(
    channelMsgId: string,
    status: MessageStatus,
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    const msg = await this.prisma.message.findFirst({ where: { channelMsgId } });
    if (!msg) return undefined;
    const updated = await this.prisma.message.update({
      where: { id: msg.id },
      data: { status },
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
  }): Promise<Contact> {
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
    await this.setIdentity(created.id, ["phone", "wa_id"], "phone", params.phone);
    await this.setIdentity(created.id, ["email"], "email", params.email);
    const full = await this.prisma.contact.findUnique({
      where: { id: created.id },
      include: { identities: true },
    });
    return mapContact(full!);
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
    try {
      if (existing) {
        if (existing.value !== v)
          await this.prisma.contactIdentity.update({ where: { id: existing.id }, data: { value: v } });
      } else {
        await this.prisma.contactIdentity.create({ data: { contactId, kind: writeKind, value: v } });
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
    if (Object.keys(data).length) await this.prisma.contact.update({ where: { id }, data });
    await this.setIdentity(id, ["phone", "wa_id"], "phone", params.phone);
    await this.setIdentity(id, ["email"], "email", params.email);
    const full = await this.prisma.contact.findUnique({ where: { id }, include: { identities: true } });
    return full ? mapContact(full) : undefined;
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

