import { Injectable } from "@nestjs/common";
import type {
  Conversation,
  ConversationWithMessages,
  Inbox,
  Message,
  Team,
  User,
} from "@ding/schemas";
import {
  DEMO_USER_ID,
  makeSeed,
  type ConversationRecord,
} from "./fixtures";

export interface ViewItem {
  key: string;
  title: string;
  count: number;
  channel?: Inbox["type"];
  handle?: string;
}

export interface SidebarViews {
  my: ViewItem[];
  shared: { teams: ViewItem[]; inboxes: ViewItem[] };
}

/**
 * The in-memory source of truth for Phase 0. Deliberately behind a small,
 * async-friendly surface so a Prisma-backed implementation can replace it
 * without touching the services or controllers.
 */
@Injectable()
export class Store {
  private users: User[];
  private teams: Team[];
  private membership: Record<string, string[]>;
  private inboxes: Inbox[];
  private conversations: ConversationRecord[];

  constructor() {
    const seed = makeSeed();
    this.users = seed.users;
    this.teams = seed.teams;
    this.membership = seed.membership;
    this.inboxes = seed.inboxes;
    this.conversations = seed.conversations;
  }

  /* ------------------------------ identity ------------------------------ */

  get demoUserId() {
    return DEMO_USER_ID;
  }

  getUser(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  teamsForUser(userId: string): string[] {
    return this.membership[userId] ?? [];
  }

  me(userId: string) {
    const user = this.getUser(userId);
    const teams = this.teams.filter((t) => this.teamsForUser(userId).includes(t.id));
    return { user, teams };
  }

  listInboxes(): Inbox[] {
    return this.inboxes;
  }

  private inbox(id: string): Inbox | undefined {
    return this.inboxes.find((i) => i.id === id);
  }

  private mentionToken(userId: string): string {
    const u = this.getUser(userId);
    return "@" + (u?.email.split("@")[0].toLowerCase() ?? "");
  }

  /* ------------------------------- views -------------------------------- */

  /** Is this conversation eligible for the user's "up for grabs" queue? */
  private isUpForGrabs(rec: ConversationRecord, userId: string): boolean {
    if (rec.assigneeUserId) return false;
    if (rec.status === "closed") return false;
    const teams = this.teamsForUser(userId);
    const inbox = this.inbox(rec.inboxId);
    return !!inbox && inbox.teamIds.some((t) => teams.includes(t));
  }

  private matchesView(rec: ConversationRecord, view: string, userId: string): boolean {
    const active = rec.status === "open" || rec.status === "pending";
    if (view === "mine") return rec.assigneeUserId === userId && active;
    if (view === "grabs") return this.isUpForGrabs(rec, userId);
    if (view === "inbound") return (rec.assigneeUserId === userId && active) || this.isUpForGrabs(rec, userId);
    if (view === "snoozed") return rec.status === "snoozed";
    if (view === "mentions") {
      const token = this.mentionToken(userId);
      return rec.messages.some((m) => m.internal && m.body.toLowerCase().includes(token));
    }
    if (view.startsWith("team:")) {
      const teamId = view.slice(5);
      const inbox = this.inbox(rec.inboxId);
      return !!inbox && inbox.teamIds.includes(teamId);
    }
    if (view.startsWith("inbox:")) return rec.inboxId === view.slice(6);
    return false;
  }

  private summary(rec: ConversationRecord): Conversation {
    const { messages: _messages, ...rest } = rec;
    void _messages;
    return rest;
  }

  listConversations(view: string, userId: string): Conversation[] {
    return this.conversations
      .filter((r) => this.matchesView(r, view, userId))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((r) => this.summary(r));
  }

  private count(view: string, userId: string): number {
    return this.conversations.filter((r) => this.matchesView(r, view, userId)).length;
  }

  views(userId: string): SidebarViews {
    const my: ViewItem[] = [
      { key: "inbound", title: "My Inbound", count: this.count("inbound", userId) },
      { key: "mine", title: "Mine", count: this.count("mine", userId) },
      { key: "grabs", title: "Up for grabs", count: this.count("grabs", userId) },
      { key: "mentions", title: "@ Mentions", count: this.count("mentions", userId) },
      { key: "snoozed", title: "Snoozed", count: this.count("snoozed", userId) },
    ];
    const userTeams = this.teamsForUser(userId);
    const teams: ViewItem[] = this.teams
      .filter((t) => userTeams.includes(t.id))
      .map((t) => ({ key: `team:${t.id}`, title: t.name, count: this.count(`team:${t.id}`, userId) }));
    const inboxes: ViewItem[] = this.inboxes
      .filter((i) => i.teamIds.some((t) => userTeams.includes(t)))
      .map((i) => ({
        key: `inbox:${i.id}`,
        title: i.name,
        count: this.count(`inbox:${i.id}`, userId),
        channel: i.type,
        handle: i.handle,
      }));
    return { my, shared: { teams, inboxes } };
  }

  /* ---------------------------- conversation ---------------------------- */

  getConversation(id: string): ConversationWithMessages | undefined {
    const rec = this.conversations.find((c) => c.id === id);
    if (!rec) return undefined;
    return { ...this.summary(rec), messages: rec.messages };
  }

  private msgSeq = 10_000;

  addMessage(
    conversationId: string,
    input: { body: string; internal: boolean },
    author: User,
  ): Message | undefined {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    const seq = ++rec.seq;
    const message: Message = {
      id: `msg_live_${++this.msgSeq}`,
      conversationId,
      seq,
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
    if (!input.internal) rec.preview = input.body;
    return message;
  }

  assign(
    conversationId: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
  ): Conversation | undefined {
    const rec = this.conversations.find((c) => c.id === conversationId);
    if (!rec) return undefined;
    if (input.assigneeUserId !== undefined) rec.assigneeUserId = input.assigneeUserId;
    if (input.assignedTeamId !== undefined) rec.assignedTeamId = input.assignedTeamId;
    rec.lastActivityAt = new Date().toISOString();
    return this.summary(rec);
  }
}
