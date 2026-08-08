import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
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
import { isInboxConnected } from "@ding/schemas";
import { env } from "../config/env";
import { canAdvanceStatus, computeWaWindow, messageTypeForKind, previewForType, templateVariableCount } from "./mappers";
import { DEMO_USER_ID, makeSeed, type ConversationRecord } from "./fixtures";
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
} from "./store";

const AVATAR_PALETTE = [
  "linear-gradient(135deg,#F97316,#DB2777)",
  "linear-gradient(135deg,#0EA5E9,#2563EB)",
  "linear-gradient(135deg,#10B981,#059669)",
  "linear-gradient(135deg,#6366F1,#A855F7)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#14B8A6,#0EA5E9)",
];

/** Zero-infrastructure store backed by in-memory fixtures. Default in dev. */
@Injectable()
export class MemoryStore extends Store {
  private users: User[];
  private teams: Team[];
  private membership: Record<string, string[]>;
  private inboxes: Inbox[];
  private conversations: ConversationRecord[];
  private contacts: Contact[];
  private templates: Template[];
  private passwords: Map<string, string>;
  /** Per-inbox provider credentials, kept server-side only (never serialised). */
  private inboxConfig = new Map<string, Record<string, string>>();
  /** Org-scoped app settings, keyed by `${orgId}::${key}` (e.g. Google OAuth creds). */
  private appSettings = new Map<string, string>();
  /** Backend-only attachment storage refs, keyed by attachment id (for serving). */
  private mediaRefs = new Map<string, StoredAttachmentRef>();
  /** Uploaded-but-not-yet-sent attachments (composer staging), keyed by id. */
  private pendingUploads = new Map<string, Attachment>();
  /** Backend-only outbound delivery bookkeeping, keyed by message id. */
  private outboundMeta = new Map<
    string,
    {
      idempotencyKey?: string;
      deliveryMeta?: OutboundDeliveryMeta;
      lastAttemptAt?: number;
      providerError?: string;
      providerErrorCode?: string;
    }
  >();
  private idSeq = 10_000;

  constructor() {
    super();
    const seed = makeSeed();
    this.users = seed.users;
    this.teams = seed.teams;
    this.membership = seed.membership;
    this.inboxes = seed.inboxes;
    this.conversations = seed.conversations;
    this.templates = seed.templates;
    this.contacts = seed.conversations.map((c) => ({ ...c.contact }));
    // Every demo user shares the dev password (real bcrypt hashing).
    const hash = bcrypt.hashSync(env.auth.devPassword, 8);
    this.passwords = new Map(this.users.map((u) => [u.id, hash]));
  }

  get demoUserId(): string {
    return DEMO_USER_ID;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const e = email.trim().toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === e);
  }

  async getPasswordHash(userId: string): Promise<string | undefined> {
    return this.passwords.get(userId);
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
    const id = `inbox_${++this.idSeq}`;
    if (params.channelConfig) this.inboxConfig.set(id, params.channelConfig);
    const inbox: Inbox = {
      id,
      orgId: params.orgId,
      type: params.type,
      name: params.name,
      handle: params.handle,
      teamIds: params.teamIds,
      routingStrategy: params.routingStrategy,
      unread: 0,
    };
    this.inboxes.push(inbox);
    return { ...inbox, connected: isInboxConnected(params.type, params.channelConfig ?? null) };
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
    const inbox = this.inboxes.find((i) => i.id === id);
    if (!inbox) return undefined;
    if (params.name !== undefined) inbox.name = params.name;
    if (params.teamIds !== undefined) inbox.teamIds = params.teamIds;
    if (params.routingStrategy !== undefined) inbox.routingStrategy = params.routingStrategy;
    if (params.channelConfig !== undefined) {
      const merged = { ...(this.inboxConfig.get(id) ?? {}), ...params.channelConfig };
      this.inboxConfig.set(id, merged);
    }
    return { ...inbox, connected: isInboxConnected(inbox.type, this.inboxConfig.get(id) ?? null) };
  }

  async deleteInbox(id: string): Promise<void> {
    this.inboxes = this.inboxes.filter((i) => i.id !== id);
    this.inboxConfig.delete(id);
    this.conversations = this.conversations.filter((c) => c.inboxId !== id);
  }

  async getInbox(id: string): Promise<Inbox | undefined> {
    const inbox = this.inboxes.find((i) => i.id === id);
    if (!inbox) return undefined;
    return { ...inbox, connected: isInboxConnected(inbox.type, this.inboxConfig.get(id) ?? null) };
  }

  async getInboxConfig(id: string): Promise<Record<string, string> | undefined> {
    return this.inboxConfig.get(id);
  }

  async getAppSetting(orgId: string, key: string): Promise<string | undefined> {
    return this.appSettings.get(`${orgId}::${key}`);
  }

  async setAppSetting(orgId: string, key: string, value: string): Promise<void> {
    this.appSettings.set(`${orgId}::${key}`, value);
  }

  /* ---- message templates ---- */

  async listTemplates(_orgId: string): Promise<Template[]> {
    return [...this.templates].sort(
      (a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language),
    );
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    return this.templates.find((t) => t.id === id);
  }

  async createTemplate(_orgId: string, input: CreateTemplateInput): Promise<Template> {
    const tpl: Template = {
      id: `tpl_${++this.idSeq}`,
      name: input.name,
      category: input.category,
      language: input.language,
      body: input.body,
      approvalStatus: "draft",
      variableCount: templateVariableCount(input.body),
    };
    this.templates.push(tpl);
    return tpl;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<Template | undefined> {
    const tpl = this.templates.find((t) => t.id === id);
    if (!tpl) return undefined;
    if (input.name !== undefined) tpl.name = input.name;
    if (input.category !== undefined) tpl.category = input.category;
    if (input.language !== undefined) tpl.language = input.language;
    if (input.body !== undefined) {
      tpl.body = input.body;
      tpl.variableCount = templateVariableCount(input.body);
    }
    if (input.approvalStatus !== undefined) tpl.approvalStatus = input.approvalStatus;
    return tpl;
  }

  async deleteTemplate(id: string): Promise<void> {
    this.templates = this.templates.filter((t) => t.id !== id);
  }

  async upsertTemplateByName(
    _orgId: string,
    input: CreateTemplateInput & { approvalStatus: Template["approvalStatus"] },
  ): Promise<Template> {
    const existing = this.templates.find((t) => t.name === input.name && t.language === input.language);
    if (existing) {
      existing.category = input.category;
      existing.body = input.body;
      existing.approvalStatus = input.approvalStatus;
      existing.variableCount = templateVariableCount(input.body);
      return existing;
    }
    const tpl: Template = {
      id: `tpl_${++this.idSeq}`,
      name: input.name,
      category: input.category,
      language: input.language,
      body: input.body,
      approvalStatus: input.approvalStatus,
      variableCount: templateVariableCount(input.body),
    };
    this.templates.push(tpl);
    return tpl;
  }

  async listTeams(): Promise<Team[]> {
    return [...this.teams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async listMembers(): Promise<Member[]> {
    return this.users.map((u) => ({ user: u, teamIds: this.membership[u.id] ?? [] }));
  }

  async createTeam(params: { orgId: string; name: string; icon?: string; slaMinutes?: number | null }): Promise<Team> {
    const order = this.teams.reduce((m, t) => Math.max(m, t.order ?? 0), -1) + 1;
    const team: Team = {
      id: `team_${++this.idSeq}`,
      orgId: params.orgId,
      name: params.name,
      icon: params.icon ?? null,
      order,
      slaMinutes: params.slaMinutes ?? null,
    };
    this.teams.push(team);
    return team;
  }

  async updateTeam(
    id: string,
    params: { name?: string; icon?: string | null; slaMinutes?: number | null },
  ): Promise<Team | undefined> {
    const team = this.teams.find((t) => t.id === id);
    if (!team) return undefined;
    if (params.name !== undefined) team.name = params.name;
    if (params.icon !== undefined) team.icon = params.icon;
    if (params.slaMinutes !== undefined) team.slaMinutes = params.slaMinutes;
    return team;
  }

  async getTeam(id: string): Promise<Team | undefined> {
    return this.teams.find((t) => t.id === id);
  }

  async reorderTeams(orderedIds: string[]): Promise<Team[]> {
    orderedIds.forEach((id, i) => {
      const team = this.teams.find((t) => t.id === id);
      if (team) team.order = i;
    });
    return this.listTeams();
  }

  async deleteTeam(id: string): Promise<void> {
    this.teams = this.teams.filter((t) => t.id !== id);
    for (const uid of Object.keys(this.membership)) {
      this.membership[uid] = this.membership[uid].filter((t) => t !== id);
    }
    for (const inbox of this.inboxes) inbox.teamIds = inbox.teamIds.filter((t) => t !== id);
    for (const c of this.conversations) if (c.assignedTeamId === id) c.assignedTeamId = null;
  }

  async createUser(params: {
    orgId: string;
    name: string;
    email: string;
    role: Role;
    teamIds: string[];
  }): Promise<User> {
    const id = `usr_${++this.idSeq}`;
    const user: User = {
      id,
      orgId: params.orgId,
      name: params.name,
      email: params.email,
      role: params.role,
      avatarColor: AVATAR_PALETTE[this.users.length % AVATAR_PALETTE.length],
      online: false,
    };
    this.users.push(user);
    this.membership[id] = params.teamIds;
    this.passwords.set(id, bcrypt.hashSync(env.auth.devPassword, 8));
    return user;
  }

  async updateUser(
    id: string,
    params: { name?: string; role?: Role; teamIds?: string[] },
  ): Promise<User | undefined> {
    const user = this.users.find((u) => u.id === id);
    if (!user) return undefined;
    if (params.name !== undefined) user.name = params.name;
    if (params.role !== undefined) user.role = params.role;
    if (params.teamIds !== undefined) this.membership[id] = params.teamIds;
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    this.users = this.users.filter((u) => u.id !== id);
    delete this.membership[id];
    this.passwords.delete(id);
    for (const c of this.conversations) if (c.assigneeUserId === id) c.assigneeUserId = null;
  }

  async teamsForUser(userId: string): Promise<string[]> {
    return this.membership[userId] ?? [];
  }

  async me(userId: string) {
    const user = this.users.find((u) => u.id === userId);
    const teamIds = this.membership[userId] ?? [];
    return { user, teams: this.teams.filter((t) => teamIds.includes(t.id)) };
  }

  async listInboxes(): Promise<Inbox[]> {
    return this.inboxes.map((i) => ({
      ...i,
      connected: isInboxConnected(i.type, this.inboxConfig.get(i.id) ?? null),
    }));
  }

  async getMembers(teamId: string): Promise<User[]> {
    const ids = Object.entries(this.membership)
      .filter(([, teams]) => teams.includes(teamId))
      .map(([userId]) => userId);
    return this.users.filter((u) => ids.includes(u.id));
  }

  private inbox(id: string): Inbox | undefined {
    return this.inboxes.find((i) => i.id === id);
  }

  private mentionToken(userId: string): string {
    const u = this.users.find((x) => x.id === userId);
    return "@" + (u?.email.split("@")[0].toLowerCase() ?? "");
  }

  private isUpForGrabs(rec: ConversationRecord, userTeams: string[]): boolean {
    if (rec.assigneeUserId) return false;
    if (rec.status === "closed" || rec.status === "snoozed") return false;
    // A conversation explicitly routed to a team is grabbable only by that team;
    // otherwise it falls to the team(s) its inbox routes to.
    if (rec.assignedTeamId) return userTeams.includes(rec.assignedTeamId);
    const inbox = this.inbox(rec.inboxId);
    return !!inbox && inbox.teamIds.some((t) => userTeams.includes(t));
  }

  /**
   * `forCount` distinguishes the sidebar badge (active work only) from the
   * conversation list (which also carries closed items so the "Closed" filter
   * has something to show). Personal queues (inbound/grabs) stay active-only.
   */
  private matchesView(
    rec: ConversationRecord,
    view: string,
    userId: string,
    userTeams: string[],
    forCount = false,
  ): boolean {
    const active = rec.status === "open" || rec.status === "pending";
    // Lists carry closed items (for the Closed filter) but never snoozed ones —
    // those live only in "Later". Counts (badges) are active-only.
    const inList = forCount ? active : rec.status !== "snoozed";
    if (view === "mine") return rec.assigneeUserId === userId && inList;
    if (view === "grabs") return this.isUpForGrabs(rec, userTeams);
    if (view === "inbound")
      return (rec.assigneeUserId === userId && inList) || this.isUpForGrabs(rec, userTeams);
    if (view === "snoozed") return rec.status === "snoozed";
    if (view === "mentions") {
      const token = this.mentionToken(userId);
      return rec.messages.some((m) => m.internal && m.body.toLowerCase().includes(token));
    }
    if (view.startsWith("team:")) {
      const teamId = view.slice(5);
      // A team's inbox = conversations routed to it (assignedTeamId), plus the
      // unrouted ones whose channel points at the team.
      const inbox = this.inbox(rec.inboxId);
      const belongs = rec.assignedTeamId
        ? rec.assignedTeamId === teamId
        : !!inbox && inbox.teamIds.includes(teamId);
      return belongs && inList;
    }
    if (view.startsWith("inbox:")) return rec.inboxId === view.slice(6) && inList;
    return false;
  }

  private summary(rec: ConversationRecord): Conversation {
    const { messages, participants: _participants, lastInboundAt, ...rest } = rec;
    void _participants;
    // Derive the last inbound time from history when not explicitly tracked, so
    // the WhatsApp window is right for seeded threads too (no inbound → closed).
    const lastInbound =
      lastInboundAt ??
      [...messages].reverse().find((m) => m.direction === "in")?.createdAt ??
      null;
    return {
      ...rest,
      snoozedUntil: rest.snoozedUntil ?? null,
      unreadCount: rest.unreadCount ?? 0,
      waWindow: computeWaWindow(rest.channel, lastInbound),
    };
  }

  /** How many snoozed conversations are now due (wake time passed). */
  private dueSnoozeCount(): number {
    const now = Date.now();
    return this.conversations.filter(
      (r) => r.status === "snoozed" && r.snoozedUntil && new Date(r.snoozedUntil).getTime() <= now,
    ).length;
  }

  async listConversations(view: string, userId: string): Promise<Conversation[]> {
    const userTeams = this.membership[userId] ?? [];
    return this.conversations
      .filter((r) => this.matchesView(r, view, userId, userTeams))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((r) => this.summary(r));
  }

  async searchConversations(query: string): Promise<Conversation[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.conversations
      .filter(
        (r) =>
          r.contact.displayName.toLowerCase().includes(q) ||
          (r.contact.company ?? "").toLowerCase().includes(q) ||
          (r.subject ?? "").toLowerCase().includes(q) ||
          (r.preview ?? "").toLowerCase().includes(q) ||
          r.messages.some((m) => (m.body ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, 30)
      .map((r) => this.summary(r));
  }

  async views(userId: string): Promise<SidebarViews> {
    const userTeams = this.membership[userId] ?? [];
    const count = (view: string) =>
      this.conversations.filter((r) => this.matchesView(r, view, userId, userTeams, true)).length;
    const my: ViewItem[] = [
      { key: "inbound", title: "My Inbound", count: count("inbound") },
      { key: "mine", title: "Mine", count: count("mine") },
      { key: "grabs", title: "Queue", count: count("grabs") },
      { key: "mentions", title: "@ Mentions", count: count("mentions") },
      { key: "snoozed", title: "Later", count: count("snoozed"), due: this.dueSnoozeCount() },
    ];
    const teams: ViewItem[] = [...this.teams]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((t) => userTeams.includes(t.id))
      .map((t) => ({ key: `team:${t.id}`, title: t.name, count: count(`team:${t.id}`) }));
    const inboxes: ViewItem[] = this.inboxes
      .filter((i) => i.teamIds.some((t) => userTeams.includes(t)))
      .map((i) => {
        const groups =
          i.type === "whatsapp"
            ? this.conversations
                .filter((c) => c.inboxId === i.id && c.channel === "whatsapp_group")
                .map((c) => ({ id: c.id, title: c.contact.displayName }))
            : [];
        return {
          key: `inbox:${i.id}`,
          title: i.name,
          count: count(`inbox:${i.id}`),
          channel: i.type,
          handle: i.handle,
          groups: groups.length ? groups : undefined,
        };
      });
    return { my, shared: { teams, inboxes } };
  }

  async getConversation(id: string): Promise<ConversationWithMessages | undefined> {
    const rec = this.conversations.find((c) => c.id === id);
    if (!rec) return undefined;
    return { ...this.summary(rec), messages: rec.messages, participants: rec.participants ?? [] };
  }

  async addMessage(
    conversationId: string,
    input: {
      body: string;
      bodyHtml?: string;
      internal: boolean;
      attachmentIds?: string[];
      quotedMsgId?: string;
      idempotencyKey?: string;
      deliveryMeta?: OutboundDeliveryMeta;
    },
    author: User,
  ): Promise<Message | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    // Claim staged uploads (attached in the composer, not yet tied to a message).
    const attachments = this.takePendingAttachments(input.attachmentIds);
    const messageType = attachments.length ? messageTypeForKind(attachments[0].kind) : "text";
    const message: Message = {
      id: `msg_live_${++this.idSeq}`,
      conversationId,
      seq: ++rec.seq,
      direction: "out",
      authorType: "user",
      authorName: author.name,
      body: input.body,
      bodyHtml: input.bodyHtml,
      // A real reply starts queued and climbs the ladder as the channel confirms
      // it (queued → sending → sent → delivered → read); notes have no ladder.
      status: input.internal ? "sent" : "queued",
      internal: input.internal,
      messageType,
      attachments,
      reactions: [],
      quotedMsgId: input.quotedMsgId,
      ...(input.internal ? {} : { attemptCount: 0 }),
      createdAt: new Date().toISOString(),
    };
    if (!input.internal && (input.idempotencyKey || input.deliveryMeta)) {
      this.outboundMeta.set(message.id, {
        idempotencyKey: input.idempotencyKey,
        deliveryMeta: input.deliveryMeta,
      });
    }
    rec.messages.push(message);
    rec.lastActivityAt = message.createdAt;
    rec.unread = false;
    rec.unreadCount = 0;
    if (!input.internal) {
      rec.preview = input.body || previewForType(messageType);
      // Replying to a snoozed conversation wakes it back into the active queue.
      if (rec.status === "snoozed") {
        rec.status = "open";
        rec.snoozedUntil = null;
      }
      // Replying to an unclaimed chat takes ownership of it.
      if (!rec.assigneeUserId && rec.status !== "closed") rec.assigneeUserId = author.id;
    }
    return message;
  }

  async createUploadAttachment(_orgId: string, input: AttachmentInput): Promise<Attachment> {
    const id = `att_${++this.idSeq}`;
    this.mediaRefs.set(id, { storageKey: input.storageKey, mime: input.mime, filename: input.filename });
    const att: Attachment = {
      id,
      kind: input.kind,
      mime: input.mime,
      size: input.size,
      filename: input.filename,
      url: `/api/media/${id}`,
      durationMs: input.durationMs,
      width: input.width,
      height: input.height,
      waveform: input.waveform,
    };
    this.pendingUploads.set(id, att);
    return att;
  }

  /** Pull staged uploads out of the pending map (they now belong to a message). */
  private takePendingAttachments(ids?: string[]): Attachment[] {
    if (!ids?.length) return [];
    const out: Attachment[] = [];
    for (const id of ids) {
      const att = this.pendingUploads.get(id);
      if (att) {
        out.push(att);
        this.pendingUploads.delete(id);
      }
    }
    return out;
  }

  async assign(
    conversationId: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
  ): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    if (input.assigneeUserId !== undefined) rec.assigneeUserId = input.assigneeUserId;
    if (input.assignedTeamId !== undefined) rec.assignedTeamId = input.assignedTeamId;
    rec.lastActivityAt = new Date().toISOString();
    return this.summary(rec);
  }

  async setStatus(conversationId: string, status: ConversationStatus): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.status = status;
    // Reopening surfaces the thread again; closing clears the unread flag.
    if (status === "closed") { rec.unread = false; rec.unreadCount = 0; }
    if (status !== "snoozed") rec.snoozedUntil = null;
    rec.lastActivityAt = new Date().toISOString();
    return this.summary(rec);
  }

  async setPriority(conversationId: string, priority: Priority): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.priority = priority;
    return this.summary(rec);
  }

  async setSla(conversationId: string, dueAt: string | null): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.slaDueAt = dueAt;
    return this.summary(rec);
  }

  async snooze(conversationId: string, until: string): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.status = "snoozed";
    rec.snoozedUntil = until;
    rec.unread = false;
    rec.unreadCount = 0;
    rec.lastActivityAt = new Date().toISOString();
    return this.summary(rec);
  }

  async setMessageChannelId(messageId: string, channelMsgId: string): Promise<void> {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.id === messageId);
      if (m) {
        m.channelMsgId = channelMsgId;
        return;
      }
    }
  }

  /* ---- durable outbound delivery ---- */

  private findMsg(messageId: string): { rec: ConversationRecord; m: Message } | undefined {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.id === messageId);
      if (m) return { rec, m };
    }
    return undefined;
  }

  async getOutboundMessage(messageId: string): Promise<OutboundMessageRef | undefined> {
    const hit = this.findMsg(messageId);
    if (!hit) return undefined;
    return {
      messageId,
      conversationId: hit.rec.id,
      status: hit.m.status,
      channelMsgId: hit.m.channelMsgId ?? undefined,
      internal: hit.m.internal,
      deliveryMeta: this.outboundMeta.get(messageId)?.deliveryMeta,
    };
  }

  async markMessageSending(messageId: string): Promise<MessageStatusChange | undefined> {
    const hit = this.findMsg(messageId);
    if (!hit) return undefined;
    if (hit.m.status !== "queued" && hit.m.status !== "sending") return undefined;
    hit.m.status = "sending";
    hit.m.attemptCount = (hit.m.attemptCount ?? 0) + 1;
    const meta = this.outboundMeta.get(messageId) ?? {};
    meta.lastAttemptAt = Date.now();
    this.outboundMeta.set(messageId, meta);
    return { conversationId: hit.rec.id, message: hit.m };
  }

  async markMessageSent(
    messageId: string,
    channelMsgId?: string,
  ): Promise<MessageStatusChange | undefined> {
    const hit = this.findMsg(messageId);
    if (!hit) return undefined;
    if (hit.m.status === "failed") return undefined;
    if (channelMsgId && !hit.m.channelMsgId) hit.m.channelMsgId = channelMsgId;
    if (canAdvanceStatus(hit.m.status, "sent")) hit.m.status = "sent";
    hit.m.failureReason = undefined;
    const meta = this.outboundMeta.get(messageId);
    if (meta) {
      meta.providerError = undefined;
      meta.providerErrorCode = undefined;
    }
    return { conversationId: hit.rec.id, message: hit.m };
  }

  async recordSendFailure(
    messageId: string,
    info: { error?: string; code?: string; permanent: boolean; reason?: string },
  ): Promise<MessageStatusChange | undefined> {
    const hit = this.findMsg(messageId);
    if (!hit) return undefined;
    const meta = this.outboundMeta.get(messageId) ?? {};
    meta.providerError = info.error ? info.error.slice(0, 500) : undefined;
    meta.providerErrorCode = info.code;
    this.outboundMeta.set(messageId, meta);
    if (info.permanent && canAdvanceStatus(hit.m.status, "failed")) {
      hit.m.status = "failed";
      hit.m.failureReason = info.reason ?? "Message could not be delivered";
    }
    return { conversationId: hit.rec.id, message: hit.m };
  }

  async listStuckOutbound(
    olderThanMs: number,
  ): Promise<Array<{ messageId: string; conversationId: string; idempotencyKey?: string }>> {
    const cutoff = Date.now() - olderThanMs;
    const out: Array<{ messageId: string; conversationId: string; idempotencyKey?: string }> = [];
    for (const rec of this.conversations) {
      for (const m of rec.messages) {
        if (m.direction !== "out" || m.internal) continue;
        if (m.status !== "queued" && m.status !== "sending") continue;
        const meta = this.outboundMeta.get(m.id);
        if (meta?.lastAttemptAt == null || meta.lastAttemptAt <= cutoff) {
          out.push({ messageId: m.id, conversationId: rec.id, idempotencyKey: meta?.idempotencyKey });
        }
      }
    }
    return out;
  }

  async resetMessageForRetry(
    messageId: string,
    idempotencyKey: string,
  ): Promise<MessageStatusChange | undefined> {
    const hit = this.findMsg(messageId);
    if (!hit) return undefined;
    if (hit.m.direction !== "out" || hit.m.internal || hit.m.status !== "failed") return undefined;
    hit.m.status = "queued";
    hit.m.failureReason = undefined;
    const meta = this.outboundMeta.get(messageId) ?? {};
    meta.idempotencyKey = idempotencyKey;
    meta.providerError = undefined;
    meta.providerErrorCode = undefined;
    meta.lastAttemptAt = undefined;
    this.outboundMeta.set(messageId, meta);
    return { conversationId: hit.rec.id, message: hit.m };
  }

  /* ---- ingestion ---- */

  async getInboxByWhatsAppPhoneId(_phoneNumberId: string): Promise<Inbox | undefined> {
    void _phoneNumberId;
    return this.inboxes.find((i) => i.type === "whatsapp");
  }

  async getInboxByEmailAddress(address: string): Promise<Inbox | undefined> {
    const a = address.trim().toLowerCase();
    return (
      this.inboxes.find((i) => i.type === "email" && i.handle.toLowerCase() === a) ??
      this.inboxes.find((i) => i.type === "email")
    );
  }

  async findConversationByMessageChannelIds(channelMsgIds: string[]): Promise<string | undefined> {
    if (!channelMsgIds.length) return undefined;
    const set = new Set(channelMsgIds);
    for (const rec of this.conversations) {
      if (rec.messages.some((m) => m.channelMsgId && set.has(m.channelMsgId))) return rec.id;
    }
    return undefined;
  }

  async upsertContactByIdentity(params: {
    orgId: string;
    kind: "phone" | "email" | "wa_id";
    value: string;
    displayName: string;
    company?: string;
    avatarColor?: string;
  }): Promise<Contact> {
    const key = params.kind === "email" ? "email" : "phone";
    const existing = this.contacts.find((c) => (c as Record<string, unknown>)[key] === params.value);
    if (existing) return existing;
    const contact: Contact = {
      id: `ct_${++this.idSeq}`,
      orgId: params.orgId,
      displayName: params.displayName,
      company: params.company,
      tags: [],
      avatarColor: params.avatarColor ?? AVATAR_PALETTE[this.contacts.length % AVATAR_PALETTE.length],
      [key]: params.value,
    } as Contact;
    this.contacts.push(contact);
    return contact;
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
    const open = this.conversations.find(
      (c) =>
        c.inboxId === params.inboxId &&
        c.contact.id === params.contact.id &&
        (c.status === "open" || c.status === "pending"),
    );
    if (open) return { conversation: this.summary(open), created: false };

    const now = new Date().toISOString();
    const rec: ConversationRecord = {
      id: `conv_${++this.idSeq}`,
      orgId: params.orgId,
      inboxId: params.inboxId,
      channel: params.channel,
      contact: params.contact,
      subject: params.subject,
      status: "open",
      assigneeUserId: params.assigneeUserId ?? null,
      assignedTeamId: params.assignedTeamId ?? null,
      priority: "normal",
      labels: [],
      unread: true,
      slaDueAt: null,
      lastActivityAt: now,
      seq: 0,
      preview: "",
      messages: [],
    };
    this.conversations.push(rec);
    return { conversation: this.summary(rec), created: true };
  }

  async appendInboundMessage(
    conversationId: string,
    input: AppendInboundInput,
  ): Promise<Message | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    const message: Message = {
      id: `msg_in_${++this.idSeq}`,
      conversationId,
      seq: ++rec.seq,
      direction: "in",
      authorType: "contact",
      authorName: input.authorName,
      body: input.body,
      bodyHtml: input.bodyHtml,
      status: "delivered",
      internal: false,
      channelMsgId: input.channelMsgId,
      messageType: input.messageType ?? "text",
      attachments: this.storeAttachments(input.attachments),
      reactions: [],
      quotedMsgId: input.quotedMsgId,
      createdAt: new Date().toISOString(),
    };
    rec.messages.push(message);
    rec.lastActivityAt = message.createdAt;
    // Inbound (re)opens the WhatsApp 24-hour customer-service window.
    rec.lastInboundAt = message.createdAt;
    rec.unread = true;
    rec.unreadCount = (rec.unreadCount ?? 0) + 1;
    rec.preview = input.body || previewForType(input.messageType);
    // A new customer message on a closed or snoozed chat wakes it back up.
    if (rec.status === "closed" || rec.status === "snoozed") {
      const wasClosed = rec.status === "closed";
      rec.status = "open";
      rec.snoozedUntil = null;
      if (wasClosed) rec.assigneeUserId = null;
    }
    return message;
  }

  async getAttachment(id: string): Promise<StoredAttachmentRef | undefined> {
    return this.mediaRefs.get(id);
  }

  /** Persist attachment refs (for serving) and return the client-facing shape. */
  private storeAttachments(inputs?: AttachmentInput[]): Attachment[] {
    if (!inputs?.length) return [];
    return inputs.map((a) => {
      const id = `att_${++this.idSeq}`;
      this.mediaRefs.set(id, { storageKey: a.storageKey, mime: a.mime, filename: a.filename });
      return {
        id,
        kind: a.kind,
        mime: a.mime,
        size: a.size,
        filename: a.filename,
        url: `/api/media/${id}`,
        durationMs: a.durationMs,
        width: a.width,
        height: a.height,
        waveform: a.waveform,
      };
    });
  }

  async updateMessageStatusByChannelId(
    channelMsgId: string,
    status: MessageStatus,
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.channelMsgId === channelMsgId);
      if (m) {
        // Never regress the ladder (out-of-order/duplicate webhooks are common).
        if (!canAdvanceStatus(m.status, status)) return undefined;
        m.status = status;
        return { conversationId: rec.id, message: m };
      }
    }
    return undefined;
  }

  async clearUnread(conversationId: string): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.unread = false;
    rec.unreadCount = 0;
    return this.summary(rec);
  }

  async getMessageRefByChannelId(
    channelMsgId: string,
  ): Promise<{ id: string; conversationId: string } | undefined> {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.channelMsgId === channelMsgId);
      if (m) return { id: m.id, conversationId: rec.id };
    }
    return undefined;
  }

  async failMessage(
    messageId: string,
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.id === messageId);
      if (!m) continue;
      if (!canAdvanceStatus(m.status, "failed")) return undefined;
      m.status = "failed";
      return { conversationId: rec.id, message: m };
    }
    return undefined;
  }

  async reactToMessage(
    messageId: string,
    emoji: string,
    by: "contact" | "user",
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.id === messageId);
      if (!m) continue;
      // At most one reaction per participant.
      const kept = (m.reactions ?? []).filter((r) => r.by !== by);
      m.reactions = emoji.trim() ? [...kept, { emoji: emoji.trim(), by }] : kept;
      return { conversationId: rec.id, message: m };
    }
    return undefined;
  }

  /* ---- groups ---- */

  async findConversationByChannelRef(channelRef: string): Promise<string | undefined> {
    return this.conversations.find((c) => c.channelRef === channelRef)?.id;
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
    const contact: Contact = {
      id: `ct_${++this.idSeq}`,
      orgId: params.orgId,
      displayName: params.displayName,
      company: params.company,
      phone: params.phone,
      email: params.email,
      tags: params.tags ?? [],
      ownerUserId: params.ownerUserId ?? undefined,
      ownerTeamId: params.ownerTeamId ?? undefined,
      avatarColor: params.avatarColor ?? AVATAR_PALETTE[this.contacts.length % AVATAR_PALETTE.length],
    };
    this.contacts.push(contact);
    return contact;
  }

  async listContacts(): Promise<Contact[]> {
    return [...this.contacts]
      .map((c) => ({ ...c, tags: c.tags ?? [] }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async getContactWithConversations(id: string): Promise<ContactWithConversations | undefined> {
    const contact = this.contacts.find((c) => c.id === id);
    if (!contact) return undefined;
    const conversations = this.conversations
      .filter((r) => r.contact.id === id)
      .sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt))
      .map((r) => this.summary(r));
    return { ...contact, tags: contact.tags ?? [], conversations };
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
    const contact = this.contacts.find((c) => c.id === id);
    if (!contact) return undefined;
    if (params.displayName !== undefined) contact.displayName = params.displayName;
    if (params.company !== undefined) contact.company = params.company || undefined;
    if (params.phone !== undefined) contact.phone = params.phone || undefined;
    if (params.email !== undefined) contact.email = params.email || undefined;
    if (params.tags !== undefined) contact.tags = params.tags;
    if (params.ownerUserId !== undefined) contact.ownerUserId = params.ownerUserId ?? undefined;
    if (params.ownerTeamId !== undefined) contact.ownerTeamId = params.ownerTeamId ?? undefined;
    // Keep the copy embedded in each conversation in sync so the UI updates too.
    for (const r of this.conversations) if (r.contact.id === id) r.contact = { ...contact, tags: contact.tags ?? [] };
    return contact;
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
    const now = new Date().toISOString();
    const id = `conv_${++this.idSeq}`;
    const participants: Participant[] = params.memberContacts.map((ct) => ({
      id: `part_${++this.idSeq}`,
      conversationId: id,
      contact: ct,
      role: "member",
      joinedAt: now,
    }));
    const rec: ConversationRecord = {
      id,
      orgId: params.orgId,
      inboxId: params.inboxId,
      channel: "whatsapp_group",
      contact: params.contact,
      subject: params.subject,
      channelRef: params.channelRef,
      inviteLink: params.inviteLink,
      status: "open",
      assigneeUserId: params.assigneeUserId ?? null,
      assignedTeamId: params.assignedTeamId ?? null,
      priority: "normal",
      labels: [],
      unread: false,
      slaDueAt: null,
      lastActivityAt: now,
      seq: 0,
      preview: `Group created · ${params.memberContacts.length} members`,
      messages: [],
      participants,
    };
    this.conversations.push(rec);
    return this.summary(rec);
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    return this.conversations.find((c) => c.id === conversationId)?.participants ?? [];
  }

  async countParticipants(conversationId: string): Promise<number> {
    return (this.conversations.find((c) => c.id === conversationId)?.participants ?? []).length;
  }

  async addParticipant(conversationId: string, contact: Contact, role: ParticipantRole = "member"): Promise<Participant> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) throw new Error(`Conversation ${conversationId} not found`);
    rec.participants ??= [];
    const existing = rec.participants.find((p) => p.contact.id === contact.id);
    if (existing) return existing;
    const p: Participant = {
      id: `part_${++this.idSeq}`,
      conversationId,
      contact,
      role,
      joinedAt: new Date().toISOString(),
    };
    rec.participants.push(p);
    return p;
  }

  async removeParticipant(conversationId: string, contactId: string): Promise<void> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (rec) rec.participants = (rec.participants ?? []).filter((p) => p.contact.id !== contactId);
  }
}
