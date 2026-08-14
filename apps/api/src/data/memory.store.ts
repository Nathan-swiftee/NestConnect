import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { hashInviteToken, newInviteToken } from "../auth/invite-token";
import type {
  Attachment,
  ChannelType,
  Contact,
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
import { CONVERSATIONS_PAGE_SIZE, isInboxConnected, MESSAGES_PAGE_SIZE, publicChannelConfig } from "@ding/schemas";
import { env } from "../config/env";
import { canAdvanceStatus, computeWaWindow, isWaChannel, messageTypeForKind, previewForType, sameTemplateLang, templateVariableCount } from "./mappers";
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
  type WebhookDiagnostic,
} from "./store";

const AVATAR_PALETTE = [
  "linear-gradient(135deg,#F97316,#DB2777)",
  "linear-gradient(135deg,#0EA5E9,#2563EB)",
  "linear-gradient(135deg,#10B981,#059669)",
  "linear-gradient(135deg,#6366F1,#A855F7)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#14B8A6,#0EA5E9)",
];

/** Recency ordering matching the Postgres store: lastActivityAt desc, id desc. */
function byRecencyDesc(a: { lastActivityAt: string; id: string }, b: { lastActivityAt: string; id: string }): number {
  return b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id);
}
function encodeMemCursor(r: { lastActivityAt: string; id: string }): string {
  return Buffer.from(`${r.lastActivityAt}::${r.id}`).toString("base64url");
}
function safeDecode(cursor: string): string {
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return "";
  }
}
function clampLimit(requested: number | undefined, fallback: number): number {
  const n = requested ?? fallback;
  return Math.min(Math.max(Math.trunc(n) || fallback, 1), 100);
}

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
  private labels: Label[];
  private passwords: Map<string, string>;
  // Pending emailed invites: userId → { sha256(token), expiry ms }.
  private invites = new Map<string, { hash: string; exp: number }>();
  /** Per-inbox provider credentials, kept server-side only (never serialised). */
  private inboxConfig = new Map<string, Record<string, string>>();
  /** Org-scoped app settings, keyed by `${orgId}::${key}` (e.g. Google OAuth creds). */
  private appSettings = new Map<string, string>();
  /** Backend-only attachment storage refs, keyed by attachment id (for serving). */
  private mediaRefs = new Map<string, StoredAttachmentRef>();
  /** Uploaded-but-not-yet-sent attachments (composer staging), keyed by id. */
  private pendingUploads = new Map<string, Attachment>();
  /** In-memory webhook diagnostics log (newest first, bounded). */
  private webhookDiagnostics: WebhookDiagnostic[] = [];
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
    this.labels = seed.labels;
    this.contacts = seed.conversations.map((c) => ({ ...c.contact }));
    // Every demo user shares the dev password (real bcrypt hashing).
    const hash = bcrypt.hashSync(env.auth.devPassword, 8);
    this.passwords = new Map(this.users.map((u) => [u.id, hash]));
  }

  get demoUserId(): string {
    return DEMO_USER_ID;
  }

  async healthCheck(): Promise<boolean> {
    return true; // in-memory store is healthy whenever the process is up
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
    return {
      ...inbox,
      connected: isInboxConnected(params.type, params.channelConfig ?? null),
      channelConfigPublic: publicChannelConfig(params.channelConfig ?? null),
    };
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
    return {
      ...inbox,
      connected: isInboxConnected(inbox.type, this.inboxConfig.get(id) ?? null),
      channelConfigPublic: publicChannelConfig(this.inboxConfig.get(id) ?? null),
    };
  }

  async deleteInbox(id: string): Promise<void> {
    this.inboxes = this.inboxes.filter((i) => i.id !== id);
    this.inboxConfig.delete(id);
    this.conversations = this.conversations.filter((c) => c.inboxId !== id);
  }

  async getInbox(id: string): Promise<Inbox | undefined> {
    const inbox = this.inboxes.find((i) => i.id === id);
    if (!inbox) return undefined;
    return {
      ...inbox,
      connected: isInboxConnected(inbox.type, this.inboxConfig.get(id) ?? null),
      channelConfigPublic: publicChannelConfig(this.inboxConfig.get(id) ?? null),
    };
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
    // Match the exact (name, language) first; fall back to the same primary
    // language so Meta's locale-qualified "en_US" updates a locally-stored "en"
    // copy rather than inserting a stale duplicate.
    const existing =
      this.templates.find((t) => t.name === input.name && t.language === input.language) ??
      this.templates.find((t) => t.name === input.name && sameTemplateLang(t.language, input.language));
    if (existing) {
      // Adopt Meta's exact language code so outbound template sends use the code
      // the template is actually approved under.
      existing.language = input.language;
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
    password?: string;
  }): Promise<{ user: User; inviteToken?: string }> {
    const id = `usr_${++this.idSeq}`;
    const user: User = {
      id,
      orgId: params.orgId,
      name: params.name,
      email: params.email,
      role: params.role,
      avatarColor: AVATAR_PALETTE[this.users.length % AVATAR_PALETTE.length],
      online: false,
      available: true,
    };
    this.users.push(user);
    this.membership[id] = params.teamIds;
    if (params.password) {
      this.passwords.set(id, bcrypt.hashSync(params.password, 8));
      return { user };
    }
    // No password given → mint an invite token; the account can't log in with a
    // known password until the invitee sets one (guard with a random hash).
    this.passwords.set(id, bcrypt.hashSync(randomBytes(24).toString("hex"), 8));
    const inv = newInviteToken();
    this.invites.set(id, { hash: inv.hash, exp: inv.expiresAt.getTime() });
    return { user, inviteToken: inv.token };
  }

  async setPasswordByInviteToken(token: string, password: string): Promise<User | undefined> {
    const hash = hashInviteToken(token);
    for (const [userId, inv] of this.invites) {
      if (inv.hash !== hash) continue;
      if (Date.now() > inv.exp) return undefined; // expired
      this.passwords.set(userId, bcrypt.hashSync(password, 8));
      this.invites.delete(userId);
      return this.users.find((u) => u.id === userId);
    }
    return undefined;
  }

  async createPasswordResetToken(email: string): Promise<{ user: User; token: string } | null> {
    const user = this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return null;
    const inv = newInviteToken();
    this.invites.set(user.id, { hash: inv.hash, exp: inv.expiresAt.getTime() });
    return { user, token: inv.token };
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

  async updateMyPreferences(
    userId: string,
    params: { available?: boolean; emailSignature?: string | null },
  ): Promise<User | undefined> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return undefined;
    if (params.available !== undefined) user.available = params.available;
    if (params.emailSignature !== undefined) user.emailSignature = params.emailSignature ?? undefined;
    return user;
  }

  async updateMyProfile(
    userId: string,
    params: { name?: string; email?: string; avatarUrl?: string | null },
  ): Promise<User | undefined> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return undefined;
    if (params.name !== undefined) user.name = params.name;
    if (params.email !== undefined) user.email = params.email;
    if (params.avatarUrl !== undefined) user.avatarUrl = params.avatarUrl ?? undefined;
    return user;
  }

  async setUserPassword(userId: string, password: string): Promise<void> {
    this.passwords.set(userId, bcrypt.hashSync(password, 8));
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
      channelConfigPublic: publicChannelConfig(this.inboxConfig.get(i.id) ?? null),
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
    if (view.startsWith("label:")) return rec.labels.some((l) => l.id === view.slice(6)) && inList;
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
    // The most recent customer-facing message's channel drives the list badge.
    const lastMsg = [...messages].reverse().find((m) => !m.internal);
    return {
      ...rest,
      snoozedUntil: rest.snoozedUntil ?? null,
      unreadCount: rest.unreadCount ?? 0,
      // Resolve the assignee's name so the UI shows the real owner, not just "You".
      assigneeName: rest.assigneeUserId
        ? this.users.find((u) => u.id === rest.assigneeUserId)?.name ?? null
        : null,
      lastChannel: lastMsg?.channel ?? rest.channel,
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

  async listConversations(
    view: string,
    userId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage> {
    const userTeams = this.membership[userId] ?? [];
    const sorted = this.conversations
      .filter((r) => this.matchesView(r, view, userId, userTeams))
      .sort(byRecencyDesc);
    return this.pageConversations(sorted, opts);
  }

  async searchConversations(
    query: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage> {
    const q = query.trim().toLowerCase();
    if (!q) return { items: [], nextCursor: null };
    const sorted = this.conversations
      .filter(
        (r) =>
          r.contact.displayName.toLowerCase().includes(q) ||
          (r.contact.company ?? "").toLowerCase().includes(q) ||
          (r.subject ?? "").toLowerCase().includes(q) ||
          (r.preview ?? "").toLowerCase().includes(q) ||
          r.messages.some((m) => (m.body ?? "").toLowerCase().includes(q)),
      )
      .sort(byRecencyDesc);
    return this.pageConversations(sorted, opts);
  }

  /** Slice a pre-sorted record list into one cursor page. */
  private pageConversations(
    sorted: ConversationRecord[],
    opts?: { cursor?: string; limit?: number },
  ): ConversationPage {
    const limit = clampLimit(opts?.limit, CONVERSATIONS_PAGE_SIZE);
    let start = 0;
    if (opts?.cursor) {
      const decoded = safeDecode(opts.cursor);
      const idx = sorted.findIndex((r) => `${r.lastActivityAt}::${r.id}` === decoded);
      start = idx >= 0 ? idx + 1 : 0;
    }
    const page = sorted.slice(start, start + limit);
    const hasMore = start + limit < sorted.length;
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.summary(r)),
      nextCursor: hasMore && last ? encodeMemCursor(last) : null,
    };
  }

  async views(userId: string): Promise<SidebarViews> {
    const userTeams = this.membership[userId] ?? [];
    // Admins & managers oversee the whole workspace: they see every team and
    // channel in the shared section, regardless of their own team memberships.
    // Personal queues (My Inbound / Mine / Queue) stay membership-scoped for all.
    const role = this.users.find((u) => u.id === userId)?.role;
    const elevated = role === "admin" || role === "manager";
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
      .filter((t) => elevated || userTeams.includes(t.id))
      .map((t) => ({ key: `team:${t.id}`, title: t.name, count: count(`team:${t.id}`) }));
    const inboxes: ViewItem[] = this.inboxes
      .filter((i) => elevated || i.teamIds.some((t) => userTeams.includes(t)))
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
    // Labels the viewer can filter by — only those actually in use (tidy sidebar);
    // the full catalogue lives in Settings + the per-conversation picker.
    const labels: ViewItem[] = [...this.labels]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => ({ key: `label:${l.id}`, title: l.name, count: count(`label:${l.id}`), color: l.color }))
      .filter((v) => v.count > 0);
    return { my, shared: { teams, inboxes, labels } };
  }

  async getConversation(id: string): Promise<ConversationWithMessages | undefined> {
    const rec = this.conversations.find((c) => c.id === id);
    if (!rec) return undefined;
    // Only the most-recent page of messages — never the full lifetime thread.
    const hasMoreMessages = rec.messages.length > MESSAGES_PAGE_SIZE;
    const messages = hasMoreMessages ? rec.messages.slice(-MESSAGES_PAGE_SIZE) : rec.messages;
    return { ...this.summary(rec), messages, hasMoreMessages, participants: rec.participants ?? [] };
  }

  async listMessages(
    conversationId: string,
    opts?: { before?: string; limit?: number },
  ): Promise<MessagePage> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return { items: [], nextCursor: null };
    const limit = clampLimit(opts?.limit, MESSAGES_PAGE_SIZE);
    const beforeSeq = opts?.before != null ? Number(opts.before) : Infinity;
    const older = rec.messages.filter((m) => m.seq < beforeSeq); // ascending by seq
    const hasMore = older.length > limit;
    const page = older.slice(Math.max(0, older.length - limit)); // most-recent `limit` older msgs
    const oldest = page[0];
    return { items: page, nextCursor: hasMore && oldest ? String(oldest.seq) : null };
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
      authorUserId: author.id,
      body: input.body,
      bodyHtml: input.bodyHtml,
      // A real reply starts queued and climbs the ladder as the channel confirms
      // it (queued → sending → sent → delivered → read); notes have no ladder.
      status: input.internal ? "sent" : "queued",
      internal: input.internal,
      messageType,
      channel: input.channel,
      attachments,
      reactions: [],
      quotedMsgId: input.quotedMsgId,
      // Surface the email headers on the message so the bubble can show them.
      email:
        input.deliveryMeta &&
        (input.deliveryMeta.subject || input.deliveryMeta.cc?.length || input.deliveryMeta.bcc?.length)
          ? {
              subject: input.deliveryMeta.subject,
              cc: input.deliveryMeta.cc,
              bcc: input.deliveryMeta.bcc,
            }
          : undefined,
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
    rec.unread = false;
    rec.unreadCount = 0;
    if (!input.internal) {
      // Only a real (non-note) message advances the card's time + list order.
      rec.lastActivityAt = message.createdAt;
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
    // Assignment must not reorder the list or reset the card time.
    return this.summary(rec);
  }

  async rerouteInboxConversations(inboxId: string): Promise<number> {
    const inbox = this.inbox(inboxId);
    if (!inbox) return 0;
    const valid = new Set(inbox.teamIds);
    const primary = inbox.teamIds[0] ?? null;
    let moved = 0;
    for (const c of this.conversations) {
      if (c.inboxId !== inboxId) continue;
      if (c.status !== "open" && c.status !== "pending") continue;
      // Leave chats already sitting on a team the channel still serves.
      if (c.assignedTeamId && valid.has(c.assignedTeamId)) continue;
      const ownerTeam = c.contact.ownerTeamId ?? null;
      const ownerUser = c.contact.ownerUserId ?? null;
      if (ownerTeam) {
        c.assignedTeamId = ownerTeam;
        c.assigneeUserId = ownerUser;
      } else {
        c.assignedTeamId = primary;
        c.assigneeUserId = ownerUser; // a pinned person keeps the chat; else queue
      }
      moved++;
    }
    return moved;
  }

  async setStatus(conversationId: string, status: ConversationStatus): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.status = status;
    // Closing clears the unread flag; a status change doesn't reorder the list.
    if (status === "closed") { rec.unread = false; rec.unreadCount = 0; }
    if (status !== "snoozed") rec.snoozedUntil = null;
    return this.summary(rec);
  }

  async setPriority(conversationId: string, priority: Priority): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.priority = priority;
    return this.summary(rec);
  }

  async setSubject(conversationId: string, subject: string | null): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.subject = subject ?? undefined;
    return this.summary(rec);
  }

  async setInviteLink(conversationId: string, inviteLink: string): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.inviteLink = inviteLink;
    return this.summary(rec);
  }

  async setConversationInbox(conversationId: string, inboxId: string): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec || rec.inboxId === inboxId) return undefined; // unknown or already there
    rec.inboxId = inboxId;
    return this.summary(rec);
  }

  async setConversationChannelRef(
    conversationId: string,
    channelRef: string,
  ): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec || rec.channelRef === channelRef) return undefined; // unknown or unchanged
    rec.channelRef = channelRef;
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
    return this.summary(rec);
  }

  async listDueSnoozed(): Promise<Conversation[]> {
    const now = Date.now();
    return this.conversations
      .filter((r) => r.status === "snoozed" && r.snoozedUntil && new Date(r.snoozedUntil).getTime() <= now)
      .map((r) => this.summary(r));
  }

  // ---- Notifications ----
  private notifications: Array<Notification & { userId: string }> = [];

  async createNotification(input: {
    userId: string;
    type: Notification["type"];
    title: string;
    body?: string;
    conversationId?: string | null;
  }): Promise<Notification> {
    const notif: Notification & { userId: string } = {
      id: `notif_${++this.idSeq}`,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      conversationId: input.conversationId ?? undefined,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.notifications.unshift(notif);
    return notif;
  }

  async listNotifications(userId: string, limit = 50): Promise<Notification[]> {
    return this.notifications.filter((n) => n.userId === userId).slice(0, limit);
  }

  async markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
    for (const n of this.notifications) {
      if (n.userId !== userId) continue;
      if (!ids || ids.includes(n.id)) n.read = true;
    }
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

  async getInboxByWhatsAppPhoneId(phoneNumberId: string): Promise<Inbox | undefined> {
    const wa = this.inboxes.filter((i) => i.type === "whatsapp" || i.type === "whatsapp_group");
    const byConfig = wa.find((i) => this.inboxConfig.get(i.id)?.phoneNumberId === phoneNumberId);
    if (byConfig) return byConfig;
    // Dev convenience: a single WhatsApp inbox with no configured number handles
    // simulated inbound (the simulate tools don't send a real phone id). If more
    // than one is unconfigured it's ambiguous — don't guess.
    const unconfigured = wa.filter((i) => !this.inboxConfig.get(i.id)?.phoneNumberId);
    return unconfigured.length === 1 ? unconfigured[0] : undefined;
  }

  async getInboxByEmailAddress(address: string): Promise<Inbox | undefined> {
    const a = address.trim().toLowerCase();
    // Deterministic match on the inbox address only — no arbitrary fallback.
    return this.inboxes.find((i) => i.type === "email" && i.handle.toLowerCase() === a);
  }

  async recordWebhookDiagnostic(input: {
    channel: string;
    kind: string;
    reference?: string;
    detail?: string;
  }): Promise<void> {
    this.webhookDiagnostics.unshift({
      id: `whd_${++this.idSeq}`,
      channel: input.channel,
      kind: input.kind,
      reference: input.reference,
      detail: input.detail,
      createdAt: new Date().toISOString(),
    });
    // Keep the in-memory log bounded.
    if (this.webhookDiagnostics.length > 200) this.webhookDiagnostics.length = 200;
  }

  async listWebhookDiagnostics(limit = 100): Promise<WebhookDiagnostic[]> {
    return this.webhookDiagnostics.slice(0, Math.min(Math.max(limit, 1), 500));
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
    // Unify by CONTACT across channels while a thread is open (closed → new chat).
    const open = [...this.conversations]
      .sort(byRecencyDesc)
      .find(
        (c) =>
          c.orgId === params.orgId &&
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
      channel: input.channel,
      messageType: input.messageType ?? "text",
      attachments: this.storeAttachments(input.attachments),
      reactions: [],
      quotedMsgId: input.quotedMsgId,
      createdAt: new Date().toISOString(),
    };
    rec.messages.push(message);
    rec.lastActivityAt = message.createdAt;
    // Only a WhatsApp inbound (re)opens the WhatsApp 24-hour window.
    if (isWaChannel(input.channel ?? rec.channel)) rec.lastInboundAt = message.createdAt;
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

  async getAttachmentAccess(
    id: string,
  ): Promise<{ storageKey: string; mime: string; filename: string; orgId?: string } | undefined> {
    const ref = this.mediaRefs.get(id);
    if (!ref) return undefined;
    // A sent attachment belongs to its conversation's org (the access boundary);
    // a staged upload isn't attached to a conversation yet → no org.
    for (const rec of this.conversations) {
      if (rec.messages.some((m) => m.attachments?.some((a) => a.id === id))) {
        return { ...ref, orgId: rec.orgId };
      }
    }
    return { ...ref };
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

  async markUnread(conversationId: string): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.unread = true;
    rec.unreadCount = 0; // manual mark → empty dot, not a message count
    return this.summary(rec);
  }

  /* ---- labels ---- */
  async listLabels(_orgId: string): Promise<Label[]> {
    return [...this.labels].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createLabel(input: { orgId: string; name: string; color: string }): Promise<Label> {
    const existing = this.labels.find((l) => l.name.toLowerCase() === input.name.trim().toLowerCase());
    if (existing) return existing; // names are unique per org — reuse rather than duplicate
    const label: Label = { id: `lbl_${++this.idSeq}`, name: input.name.trim(), color: input.color };
    this.labels.push(label);
    return label;
  }

  async updateLabel(id: string, patch: { name?: string; color?: string }): Promise<Label | undefined> {
    const label = this.labels.find((l) => l.id === id);
    if (!label) return undefined;
    if (patch.name !== undefined) label.name = patch.name.trim();
    if (patch.color !== undefined) label.color = patch.color;
    // Reflect the rename/recolour on every conversation already carrying it.
    for (const c of this.conversations) {
      const idx = c.labels.findIndex((l) => l.id === id);
      if (idx >= 0) c.labels[idx] = { ...label };
    }
    return label;
  }

  async deleteLabel(id: string): Promise<void> {
    this.labels = this.labels.filter((l) => l.id !== id);
    for (const c of this.conversations) c.labels = c.labels.filter((l) => l.id !== id);
  }

  async setConversationLabels(conversationId: string, labelIds: string[]): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    const wanted = new Set(labelIds);
    rec.labels = this.labels.filter((l) => wanted.has(l.id)).map((l) => ({ ...l }));
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
      blocked?: boolean;
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
    if (params.blocked !== undefined) contact.blocked = params.blocked;
    // Keep the copy embedded in each conversation in sync so the UI updates too.
    for (const r of this.conversations) if (r.contact.id === id) r.contact = { ...contact, tags: contact.tags ?? [] };
    return contact;
  }

  async deleteContact(id: string): Promise<void> {
    this.contacts = this.contacts.filter((c) => c.id !== id);
    // Drop the customer's own conversations (their messages ride on the record).
    this.conversations = this.conversations.filter((r) => r.contact.id !== id);
    // Remove them from any group they were a participant of.
    for (const r of this.conversations) {
      if (r.participants?.length) r.participants = r.participants.filter((p) => p.contact.id !== id);
    }
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
