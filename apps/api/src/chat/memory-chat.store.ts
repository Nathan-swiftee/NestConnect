import { Injectable } from "@nestjs/common";
import { boundOrgId } from "../tenancy/tenant-scope";
import {
  ChatStore,
  type ChatMemberPatch,
  type ChatMemberRecord,
  type ChatMessageFields,
  type ChatMessageRecord,
  type ChatPageQuery,
  type ChatRoomFields,
  type ChatRoomRecord,
} from "./chat.store";
import { chatClock } from "./chat-clock";

type Owned<T> = T & { orgId: string };
const clone = <T>(v: T): T => structuredClone(v);

/** In memory, for dev and the checks. Scoped to the bound workspace like the real one. */
@Injectable()
export class MemoryChatStore extends ChatStore {
  private rooms: Owned<ChatRoomRecord>[] = [];
  private members: ChatMemberRecord[] = [];
  private messages: ChatMessageRecord[] = [];
  private audits: Array<{ roomId: string; userId: string; at: string }> = [];
  private seen = new Map<string, string>();
  private stars: Array<{ userId: string; messageId: string; at: string }> = [];
  private seq = 0;

  private org(): string {
    return boundOrgId() ?? "org_swiftee";
  }
  private mine(r: { orgId: string }): boolean {
    const org = boundOrgId();
    return !org || r.orgId === org;
  }
  private roomIsMine(id: string): boolean {
    return this.rooms.some((r) => r.id === id && this.mine(r));
  }
  private strip({ orgId: _o, ...rest }: Owned<ChatRoomRecord>): ChatRoomRecord {
    return clone(rest);
  }
  private id(prefix: string): string {
    return `${prefix}_${String(++this.seq).padStart(8, "0")}`;
  }

  async getRoom(id: string): Promise<ChatRoomRecord | undefined> {
    const r = this.rooms.find((x) => x.id === id && this.mine(x));
    return r ? this.strip(r) : undefined;
  }
  async roomByDirectKey(key: string): Promise<ChatRoomRecord | undefined> {
    const r = this.rooms.find((x) => x.directKey === key && this.mine(x));
    return r ? this.strip(r) : undefined;
  }
  async roomByTeam(teamId: string): Promise<ChatRoomRecord | undefined> {
    const r = this.rooms.find((x) => x.teamId === teamId && this.mine(x));
    return r ? this.strip(r) : undefined;
  }
  async listRooms(ids?: string[]): Promise<ChatRoomRecord[]> {
    const want = ids ? new Set(ids) : null;
    return this.rooms.filter((r) => this.mine(r) && (!want || want.has(r.id))).map((r) => this.strip(r));
  }
  async createRoom(f: ChatRoomFields): Promise<ChatRoomRecord> {
    const now = chatClock();
    const r: Owned<ChatRoomRecord> = { ...clone(f), id: this.id("chr"), orgId: this.org(), lastMessageAt: now, createdAt: now };
    this.rooms.push(r);
    return this.strip(r);
  }
  async updateRoom(id: string, patch: Partial<Pick<ChatRoomRecord, "name" | "emoji" | "teamId">>): Promise<ChatRoomRecord | undefined> {
    const r = this.rooms.find((x) => x.id === id && this.mine(x));
    if (!r) return undefined;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
    return this.strip(r);
  }

  async listMembers(roomId: string): Promise<ChatMemberRecord[]> {
    if (!this.roomIsMine(roomId)) return [];
    return this.members.filter((m) => m.roomId === roomId).map(clone);
  }
  async membershipsOf(userId: string): Promise<ChatMemberRecord[]> {
    return this.members.filter((m) => m.userId === userId && this.roomIsMine(m.roomId)).map(clone);
  }
  async getMember(roomId: string, userId: string): Promise<ChatMemberRecord | undefined> {
    if (!this.roomIsMine(roomId)) return undefined;
    const m = this.members.find((x) => x.roomId === roomId && x.userId === userId);
    return m ? clone(m) : undefined;
  }
  async upsertMember(roomId: string, userId: string, patch: ChatMemberPatch = {}): Promise<ChatMemberRecord> {
    if (!this.roomIsMine(roomId)) throw new Error(`No chat ${roomId}`);
    let m = this.members.find((x) => x.roomId === roomId && x.userId === userId);
    if (!m) {
      m = { roomId, userId, role: "member", joinedAt: chatClock(), lastReadAt: null, lastDeliveredAt: null, mutedUntil: null, pinnedAt: null };
      this.members.push(m);
    }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (m as unknown as Record<string, unknown>)[k] = v;
    return clone(m);
  }
  async removeMember(roomId: string, userId: string): Promise<boolean> {
    if (!this.roomIsMine(roomId)) return false;
    const before = this.members.length;
    this.members = this.members.filter((m) => !(m.roomId === roomId && m.userId === userId));
    return this.members.length < before;
  }

  async createMessage(f: ChatMessageFields): Promise<ChatMessageRecord> {
    const room = this.rooms.find((x) => x.id === f.roomId && this.mine(x));
    if (!room) throw new Error(`No chat ${f.roomId}`);
    const m: ChatMessageRecord = {
      ...clone(f),
      id: this.id("chm"),
      attachments: clone(f.attachments ?? []),
      link: null,
      conversationId: f.conversationId ?? null,
      shared: clone(f.shared ?? null),
      reactions: {},
      editedAt: null,
      deletedAt: null,
      createdAt: chatClock(),
    };
    this.messages.push(m);
    room.lastMessageAt = m.createdAt;
    return clone(m);
  }
  async getMessage(id: string): Promise<ChatMessageRecord | undefined> {
    const m = this.messages.find((x) => x.id === id && this.roomIsMine(x.roomId));
    return m ? clone(m) : undefined;
  }
  async getMessages(ids: string[]): Promise<ChatMessageRecord[]> {
    const want = new Set(ids);
    return this.messages.filter((m) => want.has(m.id) && this.roomIsMine(m.roomId)).map(clone);
  }
  async listMessages(roomId: string, q: ChatPageQuery): Promise<ChatMessageRecord[]> {
    if (!this.roomIsMine(roomId)) return [];
    return this.messages
      .filter((m) => m.roomId === roomId)
      .filter((m) => !q.from || m.createdAt >= q.from)
      .filter((m) => !q.before || m.createdAt < q.before.createdAt || (m.createdAt === q.before.createdAt && m.id < q.before.id))
      .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)))
      .slice(0, q.limit)
      .map(clone);
  }
  async updateMessage(
    id: string,
    patch: Partial<Pick<ChatMessageRecord, "body" | "reactions" | "mentions" | "editedAt" | "deletedAt" | "attachments" | "link" | "conversationId" | "shared">>,
  ): Promise<ChatMessageRecord | undefined> {
    const m = this.messages.find((x) => x.id === id && this.roomIsMine(x.roomId));
    if (!m) return undefined;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (m as unknown as Record<string, unknown>)[k] = clone(v);
    return clone(m);
  }
  async lastMessages(rooms: Array<{ roomId: string; from: string | null }>): Promise<Map<string, ChatMessageRecord>> {
    const out = new Map<string, ChatMessageRecord>();
    for (const r of rooms) {
      const [m] = await this.listMessages(r.roomId, { from: r.from, limit: 1 });
      if (m) out.set(r.roomId, m);
    }
    return out;
  }
  async unreadCounts(
    userId: string,
    rooms: Array<{ roomId: string; since: string | null; from: string | null }>,
  ): Promise<Map<string, { unread: number; mentioned: boolean }>> {
    const out = new Map<string, { unread: number; mentioned: boolean }>();
    for (const r of rooms) {
      if (!this.roomIsMine(r.roomId)) continue;
      const waiting = this.messages.filter(
        (m) =>
          m.roomId === r.roomId &&
          m.kind === "text" &&
          !m.deletedAt &&
          m.authorUserId !== userId &&
          (!r.since || m.createdAt > r.since) &&
          (!r.from || m.createdAt >= r.from),
      );
      out.set(r.roomId, { unread: waiting.length, mentioned: waiting.some((m) => m.mentions.includes(userId)) });
    }
    return out;
  }

  async searchMessages(roomIds: string[], q: string, limit: number): Promise<ChatMessageRecord[]> {
    const want = new Set(roomIds.filter((id) => this.roomIsMine(id)));
    const needle = q.toLowerCase();
    return this.messages
      .filter((m) => want.has(m.roomId) && m.kind === "text" && !m.deletedAt && m.body.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async roomsWrittenIn(userId: string): Promise<string[]> {
    return [...new Set(this.messages.filter((m) => m.authorUserId === userId && this.roomIsMine(m.roomId)).map((m) => m.roomId))];
  }
  async authorsIn(roomId: string): Promise<string[]> {
    if (!this.roomIsMine(roomId)) return [];
    return [...new Set(this.messages.flatMap((m) => (m.roomId === roomId && m.authorUserId ? [m.authorUserId] : [])))];
  }
  async sharesOf(conversationId: string): Promise<ChatMessageRecord[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId && !m.deletedAt && this.roomIsMine(m.roomId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }
  async repliesTo(messageIds: string[]): Promise<ChatMessageRecord[]> {
    const want = new Set(messageIds);
    return this.messages
      .filter((m) => m.replyToId && want.has(m.replyToId) && m.kind === "text" && this.roomIsMine(m.roomId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async setStar(userId: string, messageId: string, starred: boolean): Promise<void> {
    const m = this.messages.find((x) => x.id === messageId && this.roomIsMine(x.roomId));
    if (!m) throw new Error(`No message ${messageId}`);
    this.stars = this.stars.filter((s) => !(s.userId === userId && s.messageId === messageId));
    if (starred) this.stars.push({ userId, messageId, at: chatClock() });
  }
  async starsOf(userId: string): Promise<Array<{ messageId: string; at: string }>> {
    const mine = new Set(this.messages.filter((m) => this.roomIsMine(m.roomId)).map((m) => m.id));
    return this.stars
      .filter((s) => s.userId === userId && mine.has(s.messageId))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(({ messageId, at }) => ({ messageId, at }));
  }

  async addAudit(roomId: string, userId: string): Promise<void> {
    if (this.roomIsMine(roomId)) this.audits.push({ roomId, userId, at: chatClock() });
  }
  async listAudits(roomId: string): Promise<Array<{ userId: string; at: string }>> {
    if (!this.roomIsMine(roomId)) return [];
    return this.audits.filter((a) => a.roomId === roomId).map(({ userId, at }) => ({ userId, at }));
  }

  async setLastSeen(userId: string, at: string): Promise<void> {
    this.seen.set(userId, at);
  }
  async lastSeen(userIds: string[]): Promise<Map<string, string>> {
    return new Map(userIds.filter((id) => this.seen.has(id)).map((id) => [id, this.seen.get(id)!]));
  }
}
