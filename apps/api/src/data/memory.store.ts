import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type {
  ChannelType,
  Contact,
  ContactWithConversations,
  Conversation,
  ConversationStatus,
  ConversationWithMessages,
  Inbox,
  Member,
  Message,
  MessageStatus,
  Participant,
  ParticipantRole,
  Role,
  RoutingStrategy,
  Team,
  User,
} from "@ding/schemas";
import { isInboxConnected } from "@ding/schemas";
import { env } from "../config/env";
import { DEMO_USER_ID, makeSeed, type ConversationRecord } from "./fixtures";
import { Store, type AppendInboundInput, type SidebarViews, type ViewItem } from "./store";

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
  private passwords: Map<string, string>;
  /** Per-inbox provider credentials, kept server-side only (never serialised). */
  private inboxConfig = new Map<string, Record<string, string>>();
  private idSeq = 10_000;

  constructor() {
    super();
    const seed = makeSeed();
    this.users = seed.users;
    this.teams = seed.teams;
    this.membership = seed.membership;
    this.inboxes = seed.inboxes;
    this.conversations = seed.conversations;
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

  async listTeams(): Promise<Team[]> {
    return [...this.teams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async listMembers(): Promise<Member[]> {
    return this.users.map((u) => ({ user: u, teamIds: this.membership[u.id] ?? [] }));
  }

  async createTeam(params: { orgId: string; name: string; icon?: string }): Promise<Team> {
    const order = this.teams.reduce((m, t) => Math.max(m, t.order ?? 0), -1) + 1;
    const team: Team = {
      id: `team_${++this.idSeq}`,
      orgId: params.orgId,
      name: params.name,
      icon: params.icon ?? null,
      order,
    };
    this.teams.push(team);
    return team;
  }

  async updateTeam(
    id: string,
    params: { name?: string; icon?: string | null },
  ): Promise<Team | undefined> {
    const team = this.teams.find((t) => t.id === id);
    if (!team) return undefined;
    if (params.name !== undefined) team.name = params.name;
    if (params.icon !== undefined) team.icon = params.icon;
    return team;
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
      const inbox = this.inbox(rec.inboxId);
      return !!inbox && inbox.teamIds.includes(view.slice(5)) && inList;
    }
    if (view.startsWith("inbox:")) return rec.inboxId === view.slice(6) && inList;
    return false;
  }

  private summary(rec: ConversationRecord): Conversation {
    const { messages: _messages, participants: _participants, ...rest } = rec;
    void _messages;
    void _participants;
    return { ...rest, snoozedUntil: rest.snoozedUntil ?? null };
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

  async views(userId: string): Promise<SidebarViews> {
    const userTeams = this.membership[userId] ?? [];
    const count = (view: string) =>
      this.conversations.filter((r) => this.matchesView(r, view, userId, userTeams, true)).length;
    const my: ViewItem[] = [
      { key: "inbound", title: "My Inbound", count: count("inbound") },
      { key: "mine", title: "Mine", count: count("mine") },
      { key: "grabs", title: "Up for grabs", count: count("grabs") },
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
    input: { body: string; internal: boolean },
    author: User,
  ): Promise<Message | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    const message: Message = {
      id: `msg_live_${++this.idSeq}`,
      conversationId,
      seq: ++rec.seq,
      direction: "out",
      authorType: "user",
      authorName: author.name,
      body: input.body,
      status: "sent",
      internal: input.internal,
      createdAt: new Date().toISOString(),
    };
    rec.messages.push(message);
    rec.lastActivityAt = message.createdAt;
    rec.unread = false;
    if (!input.internal) {
      rec.preview = input.body;
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
    if (status === "closed") rec.unread = false;
    if (status !== "snoozed") rec.snoozedUntil = null;
    rec.lastActivityAt = new Date().toISOString();
    return this.summary(rec);
  }

  async snooze(conversationId: string, until: string): Promise<Conversation | undefined> {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    rec.status = "snoozed";
    rec.snoozedUntil = until;
    rec.unread = false;
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
      status: "delivered",
      internal: false,
      channelMsgId: input.channelMsgId,
      createdAt: new Date().toISOString(),
    };
    rec.messages.push(message);
    rec.lastActivityAt = message.createdAt;
    rec.unread = true;
    rec.preview = input.body;
    // A new customer message on a closed or snoozed chat wakes it back up.
    if (rec.status === "closed" || rec.status === "snoozed") {
      const wasClosed = rec.status === "closed";
      rec.status = "open";
      rec.snoozedUntil = null;
      if (wasClosed) rec.assigneeUserId = null;
    }
    return message;
  }

  async updateMessageStatusByChannelId(
    channelMsgId: string,
    status: MessageStatus,
  ): Promise<{ conversationId: string; message: Message } | undefined> {
    for (const rec of this.conversations) {
      const m = rec.messages.find((x) => x.channelMsgId === channelMsgId);
      if (m) {
        m.status = status;
        return { conversationId: rec.id, message: m };
      }
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
