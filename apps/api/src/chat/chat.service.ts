import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import {
  CHAT_PAGE_SIZE,
  ChatServerEvent,
  canEditChatMessage,
  chatAttachmentLabel,
  chatMentionTokens,
  chatSharedLabel,
  directChatKey,
  mentionHandle,
  mentionsToNames,
  type AddChatMembersInput,
  type ChatAttachment,
  type ChatDiscussion,
  type ChatDiscussionThread,
  type ChatSearchHit,
  type ChatSharedConversation,
  type ChatStarred,
  type ChatMember,
  type ChatMemberRole,
  type ChatMessage,
  type ChatMessageInfo,
  type ChatMessagePage,
  type ChatPerson,
  type ChatQuote,
  type ChatRoom,
  type ChatRoomPrefsInput,
  type ChatRoomSummary,
  type ChatStatusInfo,
  type ChatSystemData,
  type CreateChatGroupInput,
  type ConversationStatus,
  type ConversationWithMessages,
  type Message,
  type SendChatMessageInput,
  type ShareConversationInput,
  type Team,
  type UpdateChatGroupInput,
  type User,
} from "@ding/schemas";
import { Store } from "../data/store";
import { ConversationLog, agent } from "../conversations/conversation-log";
import { NotificationsService } from "../notifications/notifications.service";
import { PushService } from "../push/push.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { currentOrgId, runInTenant } from "../tenancy/tenant-scope";
import { mediaUrl } from "../data/mappers";
import { chatClock } from "./chat-clock";
import { LinkPreviewService, firstLink } from "./link-preview";
import { ChatStore, type ChatMemberRecord, type ChatMessageRecord, type ChatRoomRecord } from "./chat.store";

/** The workspace setting that switches the module on. Off unless set. */
export const CHAT_MODULE_KEY = "module.team_chat";
/** "Muted" with no end: far enough off to never come round. */
const MUTED_FOREVER = "2100-01-01T00:00:00.000Z";
/** An admin reading the same chat again within this is one look, not several. */
const AUDIT_DEDUPE_MS = 10 * 60_000;
/** Per conversation: how it is now, or null once it's gone. */
type LiveCards = Map<string, { status: ConversationStatus; assigneeName: string | null } | null>;

const QUOTE_MAX = 160;
const PREVIEW_MAX = 120;

/** Everyone in the workspace, by id — names and faces for a whole request. */
type People = Map<string, User>;

/** What a request needs to know about one chat, worked out once. */
interface Access {
  room: ChatRoomRecord;
  /** Who is in it right now. For a team chat, the team. */
  memberIds: string[];
  /** My own row, when I'm in it. */
  me: ChatMemberRecord | undefined;
  isMember: boolean;
  /** An admin reading a chat they aren't in. */
  oversight: boolean;
  team: Team | undefined;
  archived: boolean;
}

const trim = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Team Chat: direct messages, groups and team chats. Who may open what (members;
 * admins read everything, read-only, and it's recorded), team chats that follow
 * their team, messages with replies, reactions, edits and deletes, read markers
 * and the ticks worked out from them, and who gets told. See docs/team-chat.md.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly chat: ChatStore,
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
    // Optional so the checks can build this without reaching the internet.
    @Optional() private readonly links?: LinkPreviewService,
  ) {}

  onModuleInit(): void {
    this.realtime.registerChat({
      members: (orgId, userId, roomId) => runInTenant(orgId, () => this.socketMembers(userId, roomId)),
      presence: (orgId, userId, online) => {
        void runInTenant(orgId, () => this.presence(userId, online)).catch((err) =>
          this.logger.debug(`presence for ${userId}: ${String(err)}`),
        );
      },
    });
  }

  /* ---- the switch ---- */

  async enabled(): Promise<boolean> {
    return (await this.store.getAppSetting(currentOrgId(), CHAT_MODULE_KEY)) === "on";
  }

  async status(userId: string): Promise<ChatStatusInfo> {
    const user = await this.user(userId);
    const elevated = user.role === "admin" || user.role === "manager";
    if (!(await this.enabled())) return { enabled: false, canCreateGroups: elevated, canOversee: user.role === "admin", unread: 0 };
    const rooms = await this.rooms(userId);
    const unread = rooms.filter((r) => !r.muted).reduce((n, r) => n + r.unread, 0);
    return { enabled: true, canCreateGroups: elevated, canOversee: user.role === "admin", unread };
  }

  /** Admins only. Off hides it everywhere and keeps every chat for switching back on. */
  async setEnabled(userId: string, enabled: boolean): Promise<ChatStatusInfo> {
    const user = await this.user(userId);
    if (user.role !== "admin") throw new ForbiddenException("Only an admin can switch modules on or off");
    await this.store.setAppSetting(currentOrgId(), CHAT_MODULE_KEY, enabled ? "on" : "off");
    return this.status(userId);
  }

  /* ---- the list ---- */

  /**
   * My chats, pinned first then most recent. With `all`, an admin sees every
   * chat in the workspace — the ones they aren't in marked as such.
   *
   * Reading the list is also my app saying it has everything up to now, so
   * this is where the second grey tick comes from.
   */
  async rooms(userId: string, all = false): Promise<ChatRoomSummary[]> {
    const user = await this.open(userId);
    const people = await this.people();
    const visible = await this.visibleRooms(user, all);

    const lasts = await this.chat.lastMessages(visible.map((a) => ({ roomId: a.room.id, from: this.visibleFrom(a) })));
    const counts = await this.chat.unreadCounts(
      userId,
      visible.filter((a) => a.isMember).map((a) => ({ roomId: a.room.id, since: a.me?.lastReadAt ?? null, from: this.visibleFrom(a) })),
    );
    // A direct chat nobody has written in yet only shows for whoever opened it.
    const shown = visible.filter((a) => a.room.kind !== "direct" || lasts.has(a.room.id) || a.room.createdById === userId);
    const others = shown.filter((a) => a.room.kind === "direct").map((a) => a.memberIds.find((id) => id !== userId) ?? "");
    const [online, seen] = await Promise.all([this.realtime.onlineAmong(others), this.chat.lastSeen(others)]);
    const quotes = await this.quotesFor([...lasts.values()], people);

    if (!all) await this.markDelivered(userId, shown.filter((a) => a.isMember), lasts);

    return shown
      .map((a) => this.summary(a, userId, people, lasts.get(a.room.id), counts.get(a.room.id), online, seen, quotes))
      .sort((x, y) => {
        if (x.pinned !== y.pinned) return x.pinned ? -1 : 1;
        return y.lastActivityAt.localeCompare(x.lastActivityAt);
      });
  }

  /** The chats this person is in — or, for an admin asking for `all`, every chat. */
  private async visibleRooms(user: User, all: boolean): Promise<Access[]> {
    await this.ensureTeamRooms();
    const [teams, memberships, members] = await Promise.all([this.store.listTeams(), this.chat.membershipsOf(user.id), this.store.listMembers()]);
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const myTeams = new Set(members.find((m) => m.user.id === user.id)?.teamIds ?? []);
    const mine = new Map(memberships.map((m) => [m.roomId, m]));
    const visible: Access[] = [];
    for (const room of await this.chat.listRooms()) {
      const team = room.teamId ? teamById.get(room.teamId) : undefined;
      const inTeam = room.kind === "team" && !!team && myTeams.has(team.id);
      // A team chat's members are its team, whatever rows of markers it holds — so
      // once the team is gone, nobody is in it (admins can still read it).
      const isMember = room.kind === "team" ? inTeam : mine.has(room.id);
      if (!isMember && !(all && user.role === "admin")) continue;
      visible.push({
        room,
        memberIds: await this.memberIds(room, team),
        me: mine.get(room.id),
        isMember,
        oversight: !isMember,
        team,
        archived: room.kind === "team" && !team,
      });
    }
    return visible;
  }

  /* ---- search and stars ---- */

  /** Messages in my chats whose words contain `q` — newest first, with where they are. */
  async search(userId: string, q: string): Promise<ChatSearchHit[]> {
    const user = await this.open(userId);
    const term = q.trim();
    if (term.length < 2) return [];
    const [rooms, people] = await Promise.all([this.visibleRooms(user, false), this.people()]);
    const byId = new Map(rooms.map((a) => [a.room.id, a]));
    const rows = await this.chat.searchMessages([...byId.keys()], term, 60);
    const hits = rows.filter((m) => {
      const from = this.visibleFrom(byId.get(m.roomId)!);
      return !from || m.createdAt >= from;
    });
    const quotes = await this.quotesFor(hits, people);
    return hits.slice(0, 50).map((m) => {
      const a = byId.get(m.roomId)!;
      return { roomId: m.roomId, roomName: this.roomName(a, userId, people), roomKind: a.room.kind, message: this.message(m, people, quotes) };
    });
  }

  async star(userId: string, messageId: string, starred: boolean): Promise<{ ok: true }> {
    const user = await this.open(userId);
    const m = await this.chat.getMessage(messageId);
    if (!m || m.kind !== "text") throw new NotFoundException("Message not found");
    const a = await this.access(user, m.roomId);
    const from = this.visibleFrom(a);
    if (from && m.createdAt < from) throw new NotFoundException("Message not found");
    await this.chat.setStar(userId, messageId, starred);
    return { ok: true };
  }

  /** My starred messages, newest star first — only from chats I can still open. */
  async starred(userId: string): Promise<ChatStarred[]> {
    const user = await this.open(userId);
    const [stars, rooms, people] = await Promise.all([this.chat.starsOf(userId), this.visibleRooms(user, user.role === "admin"), this.people()]);
    const byId = new Map(rooms.map((a) => [a.room.id, a]));
    const msgs = new Map((await this.chat.getMessages(stars.map((s) => s.messageId))).map((m) => [m.id, m]));
    const quotes = await this.quotesFor([...msgs.values()], people);
    return stars.flatMap((s) => {
      const m = msgs.get(s.messageId);
      const a = m ? byId.get(m.roomId) : undefined;
      if (!m || !a || m.deletedAt) return [];
      return [{ roomId: m.roomId, roomName: this.roomName(a, userId, people), message: this.message(m, people, quotes), starredAt: s.at }];
    });
  }

  /* ---- customer conversations, discussed ---- */

  /**
   * Bring a customer conversation into a chat: its card, and a line to go
   * with it. From the thread's Discuss…, from Discuss… on one message, or as
   * a note sent on to a chat. Anyone in the workspace can open any
   * conversation, so anyone in the chat may see the card.
   */
  async share(userId: string, input: ShareConversationInput): Promise<ChatMessage> {
    const user = await this.open(userId);
    const a = await this.writable(user, input.roomId);
    const conv = await this.store.getConversation(input.conversationId);
    if (!conv) throw new NotFoundException("Conversation not found");
    let quote: ChatSharedConversation["quote"] = null;
    if (input.messageId) {
      const msg = await this.conversationMessage(conv, input.messageId);
      if (!msg) throw new NotFoundException("That message isn't in this conversation");
      quote = {
        messageId: msg.id,
        authorName: msg.authorName || (msg.direction === "in" ? conv.contact.displayName : "Teammate"),
        body: trim((msg.body.replace(/\s+/g, " ").trim() || chatAttachmentLabel(msg.attachments ?? [])), QUOTE_MAX),
        internal: !!msg.internal,
        at: msg.createdAt,
      };
    }
    const shared: ChatSharedConversation = {
      conversationId: conv.id,
      contactName: conv.contact.displayName,
      contactAvatarColor: conv.contact.avatarColor ?? null,
      channel: conv.channel,
      subject: conv.subject ?? null,
      status: conv.status,
      assigneeName: conv.assigneeName ?? null,
      quote,
    };
    const people = await this.people();
    const body = input.body.trim();
    const rec = await this.chat.createMessage({
      roomId: a.room.id,
      authorUserId: userId,
      kind: "text",
      body,
      data: null,
      replyToId: null,
      mentions: this.mentionsIn(body, a.memberIds, people, userId),
      conversationId: conv.id,
      shared,
    });
    await this.chat.upsertMember(a.room.id, userId, { lastReadAt: chatClock() });
    const message = this.message(rec, people, new Map());
    this.emit(a, ChatServerEvent.Message, { roomId: a.room.id, message });
    this.emitReceipt(a, userId, await this.chat.getMember(a.room.id, userId));
    void this.tell(a, user, rec, people).catch((err) => this.logger.warn(`Chat notify failed: ${String(err)}`));
    // The customer's thread remembers where it was taken.
    const other = a.room.kind === "direct" ? a.memberIds.find((id) => id !== userId) : undefined;
    await new ConversationLog(this.store).record(conv.id, "shared_to_chat", agent(userId), {
      roomId: a.room.id,
      ...(other ? { withUserId: other } : { roomName: this.roomName(a, userId, people) }),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(body ? { line: trim(body, QUOTE_MAX) } : {}),
    });
    return message;
  }

  /**
   * Where a customer conversation is being discussed, in the chats I'm in. Not
   * the ones an admin could read along in: those stay something you go and
   * look at, not something that turns up on every thread.
   */
  async discussions(userId: string, conversationId: string): Promise<ChatDiscussion[]> {
    const user = await this.open(userId);
    const cards = await this.chat.sharesOf(conversationId);
    if (!cards.length) return [];
    const rooms = new Map((await this.visibleRooms(user, false)).map((a) => [a.room.id, a]));
    const mine = cards.filter((c) => {
      const a = rooms.get(c.roomId);
      const from = a ? this.visibleFrom(a) : null;
      return !!a && (!from || c.createdAt >= from);
    });
    const [replies, people, live] = await Promise.all([this.chat.repliesTo(mine.map((c) => c.id)), this.people(), this.liveCards(mine)]);
    const quotes = await this.quotesFor(replies, people);
    const out = mine.map((c): ChatDiscussion => {
      const a = rooms.get(c.roomId)!;
      const said = replies.filter((r) => r.replyToId === c.id && !r.deletedAt);
      const latest = said.at(-1);
      return {
        roomId: c.roomId,
        roomName: this.roomName(a, userId, people),
        roomKind: a.room.kind,
        canPost: this.canPost(a),
        card: this.message(c, people, quotes, live),
        replies: said.length,
        latest: latest ? this.message(latest, people, quotes) : null,
      };
    });
    const last = (d: ChatDiscussion) => d.latest?.createdAt ?? d.card.createdAt;
    return out.sort((x, y) => last(y).localeCompare(last(x)));
  }

  /** One discussion: the card and everything said in reply to it. */
  async thread(userId: string, cardId: string): Promise<ChatDiscussionThread> {
    const user = await this.open(userId);
    const card = await this.chat.getMessage(cardId);
    if (!card || !card.shared || card.deletedAt) throw new NotFoundException("Discussion not found");
    const a = await this.access(user, card.roomId);
    const from = this.visibleFrom(a);
    if (from && card.createdAt < from) throw new NotFoundException("Discussion not found");
    if (a.oversight) await this.audit(a.room.id, userId);
    const [replies, people, live] = await Promise.all([this.chat.repliesTo([card.id]), this.people(), this.liveCards([card])]);
    const quotes = await this.quotesFor(replies, people);
    return {
      roomId: a.room.id,
      roomName: this.roomName(a, userId, people),
      roomKind: a.room.kind,
      canPost: this.canPost(a),
      card: this.message(card, people, quotes, live),
      replies: replies.filter((r) => !from || r.createdAt >= from).map((r) => this.message(r, people, quotes)),
    };
  }

  /** A message in a customer conversation — usually on its latest page, else a few pages back. */
  private async conversationMessage(conv: ConversationWithMessages, id: string): Promise<Message | undefined> {
    const found = conv.messages.find((m) => m.id === id);
    if (found) return found;
    let before: string | undefined = conv.messages[0] ? String(conv.messages[0].seq) : undefined;
    for (let page = 0; page < 10 && before; page++) {
      const older = await this.store.listMessages(conv.id, { before, limit: 100 });
      const hit = older.items.find((m) => m.id === id);
      if (hit) return hit;
      before = older.nextCursor ?? undefined;
    }
    return undefined;
  }

  /** Each card's conversation as it is now: its status and who has it. */
  private async liveCards(messages: ChatMessageRecord[]): Promise<LiveCards> {
    const ids = [...new Set(messages.map((m) => m.conversationId).filter((id): id is string => !!id))];
    if (!ids.length) return new Map();
    const people = await this.people();
    const states = await Promise.all(ids.map((id) => this.store.conversationState(id).catch(() => undefined)));
    return new Map(
      ids.map((id, i) => {
        const st = states[i];
        return [id, st ? { status: st.status, assigneeName: (st.assigneeUserId && people.get(st.assigneeUserId)?.name) || null } : null];
      }),
    );
  }

  private card(m: ChatMessageRecord, live?: LiveCards): ChatSharedConversation {
    const snap = m.shared!;
    // The conversation was deleted: the card stays, saying so.
    if (!m.conversationId) return { ...snap, status: null, assigneeName: null };
    const now = live?.get(m.conversationId);
    if (now === undefined) return snap;
    return now ? { ...snap, ...now } : { ...snap, status: null, assigneeName: null };
  }

  private canPost(a: Access): boolean {
    return a.isMember && !a.archived && !(a.room.kind === "direct" && a.memberIds.length < 2);
  }

  /* ---- one chat ---- */

  async room(userId: string, roomId: string): Promise<ChatRoom> {
    const user = await this.open(userId);
    const a = await this.access(user, roomId);
    if (a.oversight) await this.audit(roomId, userId);
    // A team chat's rows are made as people first open it, so their markers have somewhere to live.
    if (a.isMember && !a.me) a.me = await this.chat.upsertMember(roomId, userId);
    return this.detail(a, user);
  }

  async messages(userId: string, roomId: string, beforeId?: string): Promise<ChatMessagePage> {
    const user = await this.open(userId);
    const a = await this.access(user, roomId);
    const before = beforeId ? await this.chat.getMessage(beforeId) : undefined;
    if (beforeId && (!before || before.roomId !== roomId)) throw new NotFoundException("Message not found");
    const rows = await this.chat.listMessages(roomId, {
      from: this.visibleFrom(a),
      before: before ? { id: before.id, createdAt: before.createdAt } : undefined,
      limit: CHAT_PAGE_SIZE + 1,
    });
    const hasMore = rows.length > CHAT_PAGE_SIZE;
    const page = rows.slice(0, CHAT_PAGE_SIZE).reverse();
    const people = await this.people();
    const [quotes, live] = await Promise.all([this.quotesFor(page, people), this.liveCards(page)]);
    return { messages: page.map((m) => this.message(m, people, quotes, live)), hasMore };
  }

  async send(userId: string, roomId: string, input: SendChatMessageInput): Promise<ChatMessage> {
    const user = await this.open(userId);
    const a = await this.writable(user, roomId);
    let replyTo: ChatMessageRecord | undefined;
    if (input.replyToId) {
      replyTo = await this.chat.getMessage(input.replyToId);
      if (!replyTo || replyTo.roomId !== roomId) throw new BadRequestException("That message isn't in this chat");
    }
    const people = await this.people();
    const mentions = this.mentionsIn(input.body, a.memberIds, people, userId);
    const attachments = await this.checkedAttachments(input.attachments ?? []);
    const rec = await this.chat.createMessage({
      roomId,
      authorUserId: userId,
      kind: "text",
      body: input.body,
      data: null,
      replyToId: replyTo?.id ?? null,
      mentions,
      attachments,
    });
    // Writing in a chat is reading it.
    await this.chat.upsertMember(roomId, userId, { lastReadAt: chatClock() });
    const quotes = await this.quotesFor([rec], people);
    const message = { ...this.message(rec, people, quotes), clientId: input.clientId ?? null };
    this.emit(a, ChatServerEvent.Message, { roomId, message });
    this.emitReceipt(a, userId, await this.chat.getMember(roomId, userId));
    void this.tell(a, user, rec, people).catch((err) => this.logger.warn(`Chat notify failed: ${String(err)}`));
    void this.attachLink(a, rec).catch((err) => this.logger.warn(`Chat link preview failed: ${String(err)}`));
    return message;
  }

  /**
   * Each attachment must be an upload in this workspace (the store is
   * tenant-scoped, so another's isn't there). What the file is and where it
   * lives come from the server's own record, not from what the client said.
   */
  private async checkedAttachments(list: ChatAttachment[]): Promise<ChatAttachment[]> {
    const out: ChatAttachment[] = [];
    for (const att of list) {
      if (out.some((x) => x.id === att.id)) continue;
      const ref = await this.store.getAttachment(att.id);
      if (!ref) throw new BadRequestException("One of those files didn't upload — try attaching it again");
      out.push({ ...att, mime: ref.mime, filename: ref.filename, url: mediaUrl(att.id) });
    }
    return out;
  }

  /** The card for the first link in a message, fetched after it's sent; nobody waits for it. */
  private async attachLink(a: Access, rec: ChatMessageRecord): Promise<void> {
    const url = firstLink(rec.body);
    if (!url || !this.links) return;
    const preview = await this.links.preview(url);
    if (!preview) return;
    const current = await this.chat.getMessage(rec.id);
    // Edited or deleted while we were fetching: only keep it if it's still the link it's about.
    if (!current || current.deletedAt || firstLink(current.body) !== url) return;
    const updated = await this.chat.updateMessage(rec.id, { link: preview });
    if (updated) await this.emitUpdated(a, updated, await this.people());
  }

  /** Change what I wrote, within the window. Mentions are re-read but nobody is told again. */
  async edit(userId: string, messageId: string, body: string): Promise<ChatMessage> {
    const user = await this.open(userId);
    const m = await this.ownMessage(messageId, userId);
    const a = await this.writable(user, m.roomId);
    if (!canEditChatMessage(m)) throw new ForbiddenException("Messages can only be edited for 15 minutes after sending");
    const people = await this.people();
    const linkChanged = firstLink(body) !== firstLink(m.body);
    const updated = await this.chat.updateMessage(messageId, {
      body,
      mentions: this.mentionsIn(body, a.memberIds, people, userId),
      editedAt: new Date().toISOString(),
      ...(linkChanged ? { link: null } : {}),
    });
    const out = await this.emitUpdated(a, updated!, people);
    if (linkChanged) void this.attachLink(a, updated!).catch((err) => this.logger.warn(`Chat link preview failed: ${String(err)}`));
    return out;
  }

  /** "Delete for everyone": my own, or anyone's for an admin or one of the group's admins. */
  async remove(userId: string, messageId: string): Promise<ChatMessage> {
    const user = await this.open(userId);
    const m = await this.chat.getMessage(messageId);
    if (!m || m.kind !== "text") throw new NotFoundException("Message not found");
    const a = await this.access(user, m.roomId);
    const mine = m.authorUserId === userId;
    const moderator = user.role === "admin" || (a.room.kind === "group" && a.me?.role === "admin");
    if (!mine && !moderator) throw new ForbiddenException("You can only delete your own messages");
    if (m.deletedAt) return this.message(m, await this.people(), new Map());
    const updated = await this.chat.updateMessage(messageId, {
      body: "",
      reactions: {},
      mentions: [],
      attachments: [],
      link: null,
      conversationId: null,
      shared: null,
      deletedAt: new Date().toISOString(),
    });
    return this.emitUpdated(a, updated!, await this.people());
  }

  /** One reaction each: the same again takes it off, another replaces it. */
  async react(userId: string, messageId: string, emoji: string): Promise<ChatMessage> {
    const user = await this.open(userId);
    const m = await this.chat.getMessage(messageId);
    if (!m || m.kind !== "text" || m.deletedAt) throw new NotFoundException("Message not found");
    const a = await this.writable(user, m.roomId);
    const had = (m.reactions[emoji] ?? []).includes(userId);
    const next: Record<string, string[]> = {};
    for (const [e, ids] of Object.entries(m.reactions)) {
      const rest = ids.filter((id) => id !== userId);
      if (rest.length) next[e] = rest;
    }
    const clean = emoji.trim();
    if (clean && !had) next[clean] = [...(next[clean] ?? []), userId];
    const updated = await this.chat.updateMessage(messageId, { reactions: next });
    return this.emitUpdated(a, updated!, await this.people());
  }

  /** Who has read one of my messages, who only has it, and who's still waiting. */
  async info(userId: string, messageId: string): Promise<ChatMessageInfo> {
    const user = await this.open(userId);
    const m = await this.chat.getMessage(messageId);
    if (!m) throw new NotFoundException("Message not found");
    const a = await this.access(user, m.roomId);
    if (m.authorUserId !== userId && user.role !== "admin") throw new ForbiddenException("Only the sender can see who's read it");
    const [rows, people] = await Promise.all([this.chat.listMembers(m.roomId), this.people()]);
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    const out: ChatMessageInfo = { readBy: [], deliveredTo: [], waiting: [] };
    for (const id of a.memberIds) {
      if (id === m.authorUserId) continue;
      const p = people.get(id);
      if (!p) continue;
      const r = byUser.get(id);
      if (r?.lastReadAt && r.lastReadAt >= m.createdAt) out.readBy.push({ person: person(p), at: r.lastReadAt });
      else if (r?.lastDeliveredAt && r.lastDeliveredAt >= m.createdAt) out.deliveredTo.push({ person: person(p), at: r.lastDeliveredAt });
      else out.waiting.push(person(p));
    }
    return out;
  }

  /** I've seen everything in this chat. */
  async read(userId: string, roomId: string): Promise<void> {
    const user = await this.open(userId);
    const a = await this.access(user, roomId);
    if (!a.isMember) return;
    const [last] = await this.chat.listMessages(roomId, { from: this.visibleFrom(a), limit: 1 });
    if (a.me?.lastReadAt && (!last || last.createdAt <= a.me.lastReadAt)) return;
    const now = chatClock();
    const me = await this.chat.upsertMember(roomId, userId, { lastReadAt: now, lastDeliveredAt: now });
    this.emitReceipt(a, userId, me);
  }

  /** My app has the latest of this chat (it arrived while I was elsewhere). */
  async delivered(userId: string, roomId: string): Promise<void> {
    const user = await this.open(userId);
    const a = await this.access(user, roomId);
    if (!a.isMember) return;
    const [last] = await this.chat.listMessages(roomId, { from: this.visibleFrom(a), limit: 1 });
    await this.markDelivered(userId, [a], new Map(last ? [[roomId, last]] : []));
  }

  async setPrefs(userId: string, roomId: string, input: ChatRoomPrefsInput): Promise<ChatRoomSummary> {
    const user = await this.open(userId);
    const a = await this.access(user, roomId);
    if (!a.isMember) throw new ForbiddenException("You aren't in this chat");
    await this.chat.upsertMember(roomId, userId, {
      ...(input.muted !== undefined ? { mutedUntil: input.muted ? MUTED_FOREVER : null } : {}),
      ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date().toISOString() : null } : {}),
    });
    const summary = (await this.rooms(userId)).find((r) => r.id === roomId);
    if (!summary) throw new NotFoundException("Chat not found");
    return summary;
  }

  /* ---- starting chats ---- */

  /** The chat with one person — the same one whoever starts it. */
  async openDirect(userId: string, otherId: string): Promise<ChatRoom> {
    const user = await this.open(userId);
    if (otherId === userId) throw new BadRequestException("That's you");
    const other = await this.store.getUser(otherId);
    if (!other) throw new NotFoundException("No one by that id in this workspace");
    const key = directChatKey(userId, otherId);
    let room = await this.chat.roomByDirectKey(key);
    if (!room) {
      try {
        room = await this.chat.createRoom({ kind: "direct", name: "", emoji: null, teamId: null, directKey: key, createdById: userId });
      } catch {
        // Both of them started it at once: the other one won, which is the same chat.
        room = await this.chat.roomByDirectKey(key);
        if (!room) throw new BadRequestException("Couldn't start that chat");
      }
    }
    await this.chat.upsertMember(room.id, userId);
    await this.chat.upsertMember(room.id, otherId);
    return this.room(user.id, room.id);
  }

  /** Admins and managers. The creator is the group's first admin. */
  async createGroup(userId: string, input: CreateChatGroupInput): Promise<ChatRoom> {
    const user = await this.open(userId);
    if (user.role !== "admin" && user.role !== "manager") throw new ForbiddenException("Only managers and admins can create groups");
    const people = await this.people();
    const ids = [...new Set(input.memberIds)].filter((id) => id !== userId && people.has(id));
    const room = await this.chat.createRoom({
      kind: "group",
      name: input.name,
      emoji: input.emoji ?? null,
      teamId: null,
      directKey: null,
      createdById: userId,
    });
    await this.chat.upsertMember(room.id, userId, { role: "admin" });
    for (const id of ids) await this.chat.upsertMember(room.id, id);
    await this.system(room.id, { event: "created", actorName: user.name, value: input.name });
    if (ids.length) await this.system(room.id, { event: "added", actorName: user.name, targetNames: ids.map((id) => people.get(id)!.name) });
    this.realtime.emitToUsers([userId, ...ids], ChatServerEvent.Room, { roomId: room.id });
    return this.room(userId, room.id);
  }

  async updateGroup(userId: string, roomId: string, input: UpdateChatGroupInput): Promise<ChatRoom> {
    const user = await this.open(userId);
    const a = await this.manageable(user, roomId);
    const patch: { name?: string; emoji?: string | null } = {};
    if (input.name !== undefined && input.name !== a.room.name) patch.name = input.name;
    if (input.emoji !== undefined && input.emoji !== a.room.emoji) patch.emoji = input.emoji;
    if (!Object.keys(patch).length) return this.room(userId, roomId);
    await this.chat.updateRoom(roomId, patch);
    if (patch.name !== undefined) await this.system(roomId, { event: "renamed", actorName: user.name, value: patch.name });
    if (patch.emoji !== undefined) await this.system(roomId, { event: "emoji", actorName: user.name, value: patch.emoji ?? undefined });
    this.emit(a, ChatServerEvent.Room, { roomId });
    return this.room(userId, roomId);
  }

  async addMembers(userId: string, roomId: string, input: AddChatMembersInput): Promise<ChatRoom> {
    const user = await this.open(userId);
    const a = await this.manageable(user, roomId);
    const people = await this.people();
    const fresh = [...new Set(input.userIds)].filter((id) => people.has(id) && !a.memberIds.includes(id));
    for (const id of fresh) await this.chat.upsertMember(roomId, id, { joinedAt: chatClock() });
    if (fresh.length) {
      await this.system(roomId, { event: "added", actorName: user.name, targetNames: fresh.map((id) => people.get(id)!.name) });
      this.realtime.emitToUsers([...a.memberIds, ...fresh], ChatServerEvent.Room, { roomId });
    }
    return this.room(userId, roomId);
  }

  async removeMember(userId: string, roomId: string, targetId: string): Promise<ChatRoom> {
    const user = await this.open(userId);
    if (targetId === userId) throw new BadRequestException("Use leave to leave a group");
    const a = await this.manageable(user, roomId);
    if (!a.memberIds.includes(targetId)) throw new NotFoundException("They aren't in this chat");
    await this.chat.removeMember(roomId, targetId);
    const people = await this.people();
    await this.system(roomId, { event: "removed", actorName: user.name, targetNames: [people.get(targetId)?.name ?? "someone"] });
    this.realtime.emitToUsers(a.memberIds, ChatServerEvent.Room, { roomId });
    this.realtime.emitToUsers([targetId], ChatServerEvent.Room, { roomId, removed: true });
    return this.room(userId, roomId);
  }

  async setRole(userId: string, roomId: string, targetId: string, role: ChatMemberRole): Promise<ChatRoom> {
    const user = await this.open(userId);
    const a = await this.manageable(user, roomId);
    const target = await this.chat.getMember(roomId, targetId);
    if (!target) throw new NotFoundException("They aren't in this chat");
    if (target.role === role) return this.room(userId, roomId);
    await this.chat.upsertMember(roomId, targetId, { role });
    const people = await this.people();
    await this.system(roomId, {
      event: role === "admin" ? "promoted" : "demoted",
      actorName: user.name,
      targetNames: [people.get(targetId)?.name ?? "someone"],
    });
    this.emit(a, ChatServerEvent.Room, { roomId });
    return this.room(userId, roomId);
  }

  /** Leave a group. A team chat follows the team, and a direct chat can't be left. */
  async leave(userId: string, roomId: string): Promise<void> {
    const user = await this.open(userId);
    const a = await this.access(user, roomId);
    if (a.room.kind !== "group") throw new BadRequestException(a.room.kind === "team" ? "Team chats follow the team" : "A direct chat can't be left");
    if (!a.isMember) throw new NotFoundException("You aren't in this chat");
    await this.chat.removeMember(roomId, userId);
    await this.system(roomId, { event: "left", actorName: user.name });
    // Somebody has to be able to run it: the longest-standing member takes over.
    const rest = await this.chat.listMembers(roomId);
    if (rest.length && !rest.some((m) => m.role === "admin")) {
      const next = [...rest].sort((x, y) => x.joinedAt.localeCompare(y.joinedAt))[0]!;
      await this.chat.upsertMember(roomId, next.userId, { role: "admin" });
    }
    this.realtime.emitToUsers(a.memberIds, ChatServerEvent.Room, { roomId });
  }

  /** When admins have read a chat they aren't in. Admins only. */
  async audits(userId: string, roomId: string): Promise<Array<{ person: ChatPerson; at: string }>> {
    const user = await this.open(userId);
    if (user.role !== "admin") throw new ForbiddenException("Admins only");
    await this.access(user, roomId);
    const [rows, people] = await Promise.all([this.chat.listAudits(roomId), this.people()]);
    return rows.flatMap((r) => (people.has(r.userId) ? [{ person: person(people.get(r.userId)!), at: r.at }] : []));
  }

  /* ---- sockets ---- */

  /** Who the gateway may let into a chat's room: members, and admins reading along. */
  private async socketMembers(userId: string, roomId: string): Promise<string[] | null> {
    if (!(await this.enabled())) return null;
    const user = await this.store.getUser(userId);
    if (!user) return null;
    try {
      const a = await this.access(user, roomId);
      return a.memberIds;
    } catch {
      return null;
    }
  }

  private async presence(userId: string, online: boolean): Promise<void> {
    if (!(await this.enabled())) return;
    const at = new Date().toISOString();
    if (!online) await this.chat.setLastSeen(userId, at);
    this.realtime.emitChatPresence(currentOrgId(), userId, online, online ? null : at);
  }

  /* ---- rules ---- */

  private async user(userId: string): Promise<User> {
    const user = await this.store.getUser(userId);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  /** The module is on, and here's who's asking. */
  private async open(userId: string): Promise<User> {
    const user = await this.user(userId);
    if (!(await this.enabled())) throw new NotFoundException("Team Chat is switched off");
    return user;
  }

  /** May this person open this chat at all? Members can; admins can read anything. */
  private async access(user: User, roomId: string): Promise<Access> {
    const room = await this.chat.getRoom(roomId);
    if (!room) throw new NotFoundException("Chat not found");
    const team = room.teamId ? await this.store.getTeam(room.teamId) : undefined;
    const memberIds = await this.memberIds(room, team);
    const isMember = memberIds.includes(user.id);
    // Somebody who can't see a chat is told it doesn't exist, not that it's private.
    if (!isMember && user.role !== "admin") throw new NotFoundException("Chat not found");
    return {
      room,
      memberIds,
      me: isMember ? await this.chat.getMember(roomId, user.id) : undefined,
      isMember,
      oversight: !isMember,
      team,
      archived: room.kind === "team" && !team,
    };
  }

  /** …and write in it: members only, and not in a team chat whose team is gone. */
  private async writable(user: User, roomId: string): Promise<Access> {
    const a = await this.access(user, roomId);
    if (!a.isMember) throw new ForbiddenException("Admins can read this chat but not write in it");
    if (a.archived) throw new ForbiddenException("This team has been deleted; its chat is read-only");
    if (a.room.kind === "direct" && a.memberIds.length < 2) throw new ForbiddenException("They're no longer in this workspace");
    return a;
  }

  /** …and run it: a group, by one of its admins or a workspace admin. */
  private async manageable(user: User, roomId: string): Promise<Access> {
    const a = await this.access(user, roomId);
    if (a.room.kind !== "group") throw new BadRequestException(a.room.kind === "team" ? "A team chat's members are the team's" : "A direct chat has no settings");
    if (user.role !== "admin" && a.me?.role !== "admin") throw new ForbiddenException("Only the group's admins can change it");
    return a;
  }

  private async ownMessage(messageId: string, userId: string): Promise<ChatMessageRecord> {
    const m = await this.chat.getMessage(messageId);
    if (!m || m.kind !== "text") throw new NotFoundException("Message not found");
    if (m.authorUserId !== userId) throw new ForbiddenException("You can only change your own messages");
    if (m.deletedAt) throw new BadRequestException("That message was deleted");
    return m;
  }

  /**
   * Who is in a chat. A team chat is its team — whoever is on it today. Once
   * the team is deleted its chat has nobody in it: it's kept, and admins can
   * still read it, but there's no longer a team to say who else should.
   */
  private async memberIds(room: ChatRoomRecord, team: Team | undefined): Promise<string[]> {
    if (room.kind === "team") return team ? (await this.store.getMembers(team.id)).map((u) => u.id) : [];
    const rows = await this.chat.listMembers(room.id);
    if (room.kind === "direct") {
      // Someone who has left the workspace drops out of the chat with them.
      const users = await Promise.all(rows.map((r) => this.store.getUser(r.userId)));
      return rows.filter((_, i) => users[i]).map((r) => r.userId);
    }
    return rows.map((r) => r.userId);
  }

  /** A group shows what was said since you joined it; team and direct chats show everything. */
  private visibleFrom(a: Pick<Access, "room" | "me" | "isMember">): string | null {
    return a.room.kind === "group" && a.isMember && a.me ? a.me.joinedAt : null;
  }

  /** Every team has a chat. Made as they're first needed, so there's nothing to set up. */
  private async ensureTeamRooms(): Promise<void> {
    const [teams, rooms] = await Promise.all([this.store.listTeams(), this.chat.listRooms()]);
    const have = new Set(rooms.map((r) => r.teamId).filter(Boolean));
    for (const t of teams) {
      if (have.has(t.id)) continue;
      try {
        await this.chat.createRoom({ kind: "team", name: t.name, emoji: null, teamId: t.id, directKey: null, createdById: null });
      } catch {
        // Made by a request running alongside this one.
      }
    }
  }

  private async people(): Promise<People> {
    return new Map((await this.store.listMembers()).map((m) => [m.user.id, m.user]));
  }

  private async audit(roomId: string, userId: string): Promise<void> {
    const recent = (await this.chat.listAudits(roomId)).find((x) => x.userId === userId);
    if (recent && Date.now() - new Date(recent.at).getTime() < AUDIT_DEDUPE_MS) return;
    await this.chat.addAudit(roomId, userId);
  }

  /** "@nathan" → Nathan's id, for the people in this chat. Never the author. */
  private mentionsIn(body: string, memberIds: string[], people: People, authorId: string): string[] {
    const tokens = chatMentionTokens(body);
    if (!tokens.size) return [];
    return memberIds.filter((id) => id !== authorId && people.has(id) && tokens.has(mentionHandle(people.get(id)!)));
  }

  private async system(roomId: string, data: ChatSystemData): Promise<void> {
    const rec = await this.chat.createMessage({ roomId, authorUserId: null, kind: "system", body: "", data, replyToId: null, mentions: [] });
    const room = await this.chat.getRoom(roomId);
    if (!room) return;
    const team = room.teamId ? await this.store.getTeam(room.teamId) : undefined;
    const ids = await this.memberIds(room, team);
    this.realtime.emitToUsers(ids, ChatServerEvent.Message, { roomId, message: this.message(rec, await this.people(), new Map()) });
  }

  /** The second grey tick: my app has everything in these chats. */
  private async markDelivered(userId: string, rooms: Access[], lasts: Map<string, ChatMessageRecord>): Promise<void> {
    for (const a of rooms) {
      const last = lasts.get(a.room.id);
      if (!last || last.authorUserId === userId) continue;
      const mark = a.me?.lastDeliveredAt && a.me.lastDeliveredAt > (a.me.lastReadAt ?? "") ? a.me.lastDeliveredAt : a.me?.lastReadAt;
      if (mark && mark >= last.createdAt) continue;
      const me = await this.chat.upsertMember(a.room.id, userId, { lastDeliveredAt: chatClock() });
      this.emitReceipt(a, userId, me);
    }
  }

  /* ---- telling people ---- */

  /**
   * Who hears about a new message: everyone else in the chat who hasn't muted
   * it. Someone it @-mentions always does, muted or not, and gets a bell entry
   * too — the push service then applies quiet hours, "already looking at it"
   * and the rate limit, the same rules as everywhere else.
   */
  private async tell(a: Access, author: User, m: ChatMessageRecord, people: People): Promise<void> {
    const rows = new Map((await this.chat.listMembers(a.room.id)).map((r) => [r.userId, r]));
    const now = new Date().toISOString();
    const text =
      trim(mentionsToNames(m.body, [...people.values()]), PREVIEW_MAX) || chatAttachmentLabel(m.attachments) || (m.shared ? chatSharedLabel(m.shared) : "");
    const title = a.room.kind === "direct" ? author.name : this.roomName(a, author.id, people);
    const body = a.room.kind === "direct" ? text : `${author.name}: ${text}`;

    const mentioned = new Set(m.mentions);
    const others = a.memberIds.filter((id) => id !== author.id);
    const quiet = others.filter((id) => !mentioned.has(id) && (rows.get(id)?.mutedUntil ?? "") > now);
    const told = others.filter((id) => !mentioned.has(id) && !quiet.includes(id));

    if (told.length) {
      this.push.notify({ userIds: told, kind: "chat_message", title, body, chatRoomId: a.room.id, actorUserId: author.id });
    }
    for (const id of mentioned) {
      await this.notifications.create(id, {
        type: "chat_mention",
        title: a.room.kind === "direct" ? `${author.name} mentioned you` : `${author.name} mentioned you in ${title}`,
        body: text,
        chatRoomId: a.room.id,
        actorUserId: author.id,
      });
    }
  }

  private emit(
    a: Access,
    event: typeof ChatServerEvent.Message | typeof ChatServerEvent.MessageUpdated | typeof ChatServerEvent.Room,
    payload: { roomId: string; message?: ChatMessage },
  ): void {
    // Members wherever they are in the app, and an admin reading along with it open.
    this.realtime.emitToUsers(a.memberIds, event, payload as never, a.room.id);
  }

  private emitReceipt(a: Access, userId: string, me: ChatMemberRecord | undefined): void {
    if (!me) return;
    this.realtime.emitToUsers(
      a.memberIds,
      ChatServerEvent.Receipt,
      { roomId: a.room.id, userId, lastReadAt: me.lastReadAt, lastDeliveredAt: me.lastDeliveredAt },
      a.room.id,
    );
  }

  private async emitUpdated(a: Access, m: ChatMessageRecord, people: People): Promise<ChatMessage> {
    const quotes = await this.quotesFor([m], people);
    const message = this.message(m, people, quotes);
    this.emit(a, ChatServerEvent.MessageUpdated, { roomId: a.room.id, message });
    return message;
  }

  /* ---- shaping ---- */

  private roomName(a: Access, userId: string, people: People): string {
    if (a.room.kind === "team") return a.team?.name ?? (a.room.name || "Former team");
    if (a.room.kind === "group") return a.room.name;
    const otherId = a.memberIds.find((id) => id !== userId);
    return (otherId && people.get(otherId)?.name) || "Former teammate";
  }

  private summary(
    a: Access,
    userId: string,
    people: People,
    last: ChatMessageRecord | undefined,
    count: { unread: number; mentioned: boolean } | undefined,
    online: Set<string>,
    seen: Map<string, string>,
    quotes: Map<string, ChatQuote>,
  ): ChatRoomSummary {
    // For an admin reading someone else's direct chat, "the other person" is either of them.
    const otherId = a.room.kind === "direct" ? (a.memberIds.find((id) => id !== userId) ?? null) : null;
    const other = otherId ? people.get(otherId) : undefined;
    const now = new Date().toISOString();
    return {
      id: a.room.id,
      kind: a.room.kind,
      name:
        a.oversight && a.room.kind === "direct"
          ? a.memberIds.map((id) => people.get(id)?.name ?? "Former teammate").join(" & ")
          : this.roomName(a, userId, people),
      emoji: a.room.kind === "team" ? null : a.room.emoji,
      teamId: a.room.teamId,
      other: other && !a.oversight ? { ...person(other), online: online.has(other.id), lastSeenAt: seen.get(other.id) ?? null } : null,
      memberCount: a.memberIds.length,
      lastMessage: last ? this.message(last, people, quotes) : null,
      lastActivityAt: last?.createdAt ?? a.room.createdAt,
      unread: count?.unread ?? 0,
      mentioned: count?.mentioned ?? false,
      pinned: !!a.me?.pinnedAt,
      muted: (a.me?.mutedUntil ?? "") > now,
      isMember: a.isMember,
      archived: a.archived,
    };
  }

  private async detail(a: Access, user: User): Promise<ChatRoom> {
    const people = await this.people();
    const rows = new Map((await this.chat.listMembers(a.room.id)).map((r) => [r.userId, r]));
    const [online, seen] = await Promise.all([this.realtime.onlineAmong(a.memberIds), this.chat.lastSeen(a.memberIds)]);
    const [last] = await this.chat.listMessages(a.room.id, { from: this.visibleFrom(a), limit: 1 });
    const lasts = new Map(last ? [[a.room.id, last]] : []);
    const quotes = await this.quotesFor(last ? [last] : [], people);
    const count = a.isMember
      ? (await this.chat.unreadCounts(user.id, [{ roomId: a.room.id, since: a.me?.lastReadAt ?? null, from: this.visibleFrom(a) }])).get(a.room.id)
      : undefined;
    const members: ChatMember[] = a.memberIds
      .filter((id) => people.has(id))
      .map((id) => {
        const r = rows.get(id);
        return {
          ...person(people.get(id)!),
          role: a.room.kind === "group" ? (r?.role ?? "member") : "member",
          lastReadAt: r?.lastReadAt ?? null,
          lastDeliveredAt: r?.lastDeliveredAt ?? null,
          online: online.has(id),
          lastSeenAt: seen.get(id) ?? null,
        };
      })
      .sort((x, y) => (x.id === user.id ? -1 : y.id === user.id ? 1 : x.name.localeCompare(y.name)));
    const canManage = a.room.kind === "group" && (user.role === "admin" || a.me?.role === "admin");
    return {
      ...this.summary(a, user.id, people, lasts.get(a.room.id), count, online, seen, quotes),
      members,
      myRole: a.isMember ? (a.room.kind === "group" ? (a.me?.role ?? "member") : "member") : null,
      canManage,
      canPost: this.canPost(a),
      canLeave: a.isMember && a.room.kind === "group",
      oversight: a.oversight,
      createdAt: a.room.createdAt,
    };
  }

  /** The quoted messages for a page of replies, fetched in one go. */
  private async quotesFor(messages: ChatMessageRecord[], people: People): Promise<Map<string, ChatQuote>> {
    const ids = [...new Set(messages.map((m) => m.replyToId).filter((id): id is string => !!id))];
    const rows = await this.chat.getMessages(ids);
    return new Map(
      rows.map((q) => [
        q.id,
        {
          id: q.id,
          authorId: q.authorUserId,
          authorName: (q.authorUserId && people.get(q.authorUserId)?.name) || "Former teammate",
          // A card or a photo with nothing written says what it was.
          body: q.deletedAt
            ? ""
            : trim(mentionsToNames(q.body, [...people.values()]) || chatAttachmentLabel(q.attachments) || (q.shared ? chatSharedLabel(q.shared) : ""), QUOTE_MAX),
          deleted: !!q.deletedAt,
        },
      ]),
    );
  }

  private message(m: ChatMessageRecord, people: People, quotes: Map<string, ChatQuote>, live?: LiveCards): ChatMessage {
    const author = m.authorUserId ? people.get(m.authorUserId) : undefined;
    return {
      id: m.id,
      roomId: m.roomId,
      kind: m.kind,
      author: author ? person(author) : m.authorUserId ? { id: m.authorUserId, name: "Former teammate", avatarColor: null, avatarUrl: null } : null,
      body: m.deletedAt ? "" : m.body,
      system: m.kind === "system" ? m.data : null,
      replyTo: m.replyToId && !m.deletedAt ? (quotes.get(m.replyToId) ?? null) : null,
      reactions: Object.entries(m.reactions).map(([emoji, userIds]) => ({ emoji, userIds })),
      attachments: m.deletedAt ? [] : m.attachments,
      link: m.deletedAt ? null : m.link,
      shared: m.deletedAt || !m.shared ? null : this.card(m, live),
      mentions: m.mentions,
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
      createdAt: m.createdAt,
    };
  }
}

function person(u: User): ChatPerson {
  return { id: u.id, name: u.name, avatarColor: u.avatarColor ?? null, avatarUrl: u.avatarUrl ?? null };
}
