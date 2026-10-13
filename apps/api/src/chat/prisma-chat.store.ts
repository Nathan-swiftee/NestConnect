import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ChatAttachment, ChatLinkPreview, ChatMemberRole, ChatRoomKind, ChatSystemData } from "@ding/schemas";
import { PrismaService } from "../data/prisma.service";
import { tenantScoped, type TenantPrisma } from "../data/tenant-prisma";
import { currentOrgId } from "../tenancy/tenant-scope";
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

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const date = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);
const json = (v: unknown) => v as Prisma.InputJsonValue;

function toRoom(r: Prisma.ChatRoomGetPayload<object>): ChatRoomRecord {
  return {
    id: r.id,
    kind: r.kind as ChatRoomKind,
    name: r.name,
    emoji: r.emoji,
    teamId: r.teamId,
    directKey: r.directKey,
    createdById: r.createdById,
    lastMessageAt: r.lastMessageAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

function toMember(m: Prisma.ChatMemberGetPayload<object>): ChatMemberRecord {
  return {
    roomId: m.roomId,
    userId: m.userId,
    role: m.role as ChatMemberRole,
    joinedAt: m.joinedAt.toISOString(),
    lastReadAt: iso(m.lastReadAt),
    lastDeliveredAt: iso(m.lastDeliveredAt),
    mutedUntil: iso(m.mutedUntil),
    pinnedAt: iso(m.pinnedAt),
  };
}

function toMessage(m: Prisma.ChatMessageGetPayload<object>): ChatMessageRecord {
  return {
    id: m.id,
    roomId: m.roomId,
    authorUserId: m.authorUserId,
    kind: m.kind === "system" ? "system" : "text",
    body: m.body,
    data: (m.data as unknown as ChatSystemData | null) ?? null,
    replyToId: m.replyToId,
    reactions: (m.reactions as unknown as Record<string, string[]>) ?? {},
    mentions: (m.mentions as unknown as string[]) ?? [],
    attachments: (m.attachments as unknown as ChatAttachment[]) ?? [],
    link: (m.link as unknown as ChatLinkPreview | null) ?? null,
    editedAt: iso(m.editedAt),
    deletedAt: iso(m.deletedAt),
    createdAt: m.createdAt.toISOString(),
  };
}

function memberColumns(p: ChatMemberPatch): Prisma.ChatMemberUncheckedUpdateInput {
  const out: Prisma.ChatMemberUncheckedUpdateInput = {};
  if (p.role !== undefined) out.role = p.role;
  if (p.joinedAt) out.joinedAt = new Date(p.joinedAt);
  for (const k of ["lastReadAt", "lastDeliveredAt", "mutedUntil", "pinnedAt"] as const) {
    if (p[k] !== undefined) out[k] = date(p[k]);
  }
  return out;
}

/** Postgres, through the tenant-scoped client: every query is the bound
 *  workspace's, and a person, team or chat from another workspace is refused on write. */
@Injectable()
export class PrismaChatStore extends ChatStore {
  private readonly prisma: TenantPrisma;

  constructor(root: PrismaService) {
    super();
    this.prisma = tenantScoped(root);
  }

  async getRoom(id: string): Promise<ChatRoomRecord | undefined> {
    const r = await this.prisma.chatRoom.findUnique({ where: { id } });
    return r ? toRoom(r) : undefined;
  }
  async roomByDirectKey(key: string): Promise<ChatRoomRecord | undefined> {
    const r = await this.prisma.chatRoom.findFirst({ where: { directKey: key } });
    return r ? toRoom(r) : undefined;
  }
  async roomByTeam(teamId: string): Promise<ChatRoomRecord | undefined> {
    const r = await this.prisma.chatRoom.findFirst({ where: { teamId } });
    return r ? toRoom(r) : undefined;
  }
  async listRooms(ids?: string[]): Promise<ChatRoomRecord[]> {
    const rows = await this.prisma.chatRoom.findMany({ where: ids ? { id: { in: ids } } : {} });
    return rows.map(toRoom);
  }
  async createRoom(f: ChatRoomFields): Promise<ChatRoomRecord> {
    const now = new Date(chatClock());
    const r = await this.prisma.chatRoom.create({
      data: {
        orgId: currentOrgId(),
        kind: f.kind,
        name: f.name,
        emoji: f.emoji,
        teamId: f.teamId,
        directKey: f.directKey,
        createdById: f.createdById,
        lastMessageAt: now,
        createdAt: now,
      },
    });
    return toRoom(r);
  }
  async updateRoom(id: string, patch: Partial<Pick<ChatRoomRecord, "name" | "emoji" | "teamId">>): Promise<ChatRoomRecord | undefined> {
    const data: Prisma.ChatRoomUncheckedUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.emoji !== undefined) data.emoji = patch.emoji;
    if (patch.teamId !== undefined) data.teamId = patch.teamId;
    const n = await this.prisma.chatRoom.updateMany({ where: { id }, data });
    return n.count ? this.getRoom(id) : undefined;
  }

  async listMembers(roomId: string): Promise<ChatMemberRecord[]> {
    const rows = await this.prisma.chatMember.findMany({ where: { roomId }, orderBy: { joinedAt: "asc" } });
    return rows.map(toMember);
  }
  async membershipsOf(userId: string): Promise<ChatMemberRecord[]> {
    const rows = await this.prisma.chatMember.findMany({ where: { userId } });
    return rows.map(toMember);
  }
  async getMember(roomId: string, userId: string): Promise<ChatMemberRecord | undefined> {
    const m = await this.prisma.chatMember.findFirst({ where: { roomId, userId } });
    return m ? toMember(m) : undefined;
  }
  async upsertMember(roomId: string, userId: string, patch: ChatMemberPatch = {}): Promise<ChatMemberRecord> {
    const existing = await this.getMember(roomId, userId);
    if (existing) {
      if (Object.keys(patch).length) {
        await this.prisma.chatMember.updateMany({ where: { roomId, userId }, data: memberColumns(patch) });
      }
      return (await this.getMember(roomId, userId))!;
    }
    const cols = memberColumns(patch);
    const m = await this.prisma.chatMember.create({
      data: {
        roomId,
        userId,
        role: (cols.role as string | undefined) ?? "member",
        joinedAt: (cols.joinedAt as Date | null | undefined) ?? new Date(chatClock()),
        lastReadAt: (cols.lastReadAt as Date | null | undefined) ?? null,
        lastDeliveredAt: (cols.lastDeliveredAt as Date | null | undefined) ?? null,
        mutedUntil: (cols.mutedUntil as Date | null | undefined) ?? null,
        pinnedAt: (cols.pinnedAt as Date | null | undefined) ?? null,
      },
    });
    return toMember(m);
  }
  async removeMember(roomId: string, userId: string): Promise<boolean> {
    const n = await this.prisma.chatMember.deleteMany({ where: { roomId, userId } });
    return n.count > 0;
  }

  async createMessage(f: ChatMessageFields): Promise<ChatMessageRecord> {
    const at = new Date(chatClock());
    const m = await this.prisma.chatMessage.create({
      data: {
        roomId: f.roomId,
        authorUserId: f.authorUserId,
        kind: f.kind,
        body: f.body,
        data: f.data ? json(f.data) : undefined,
        replyToId: f.replyToId,
        mentions: json(f.mentions),
        attachments: json(f.attachments ?? []),
        createdAt: at,
      },
    });
    await this.prisma.chatRoom.updateMany({ where: { id: f.roomId }, data: { lastMessageAt: at } });
    return toMessage(m);
  }
  async getMessage(id: string): Promise<ChatMessageRecord | undefined> {
    const m = await this.prisma.chatMessage.findUnique({ where: { id } });
    return m ? toMessage(m) : undefined;
  }
  async getMessages(ids: string[]): Promise<ChatMessageRecord[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.chatMessage.findMany({ where: { id: { in: ids } } });
    return rows.map(toMessage);
  }
  async listMessages(roomId: string, q: ChatPageQuery): Promise<ChatMessageRecord[]> {
    const and: Prisma.ChatMessageWhereInput[] = [{ roomId }];
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.before) {
      const at = new Date(q.before.createdAt);
      and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: q.before.id } }] });
    }
    const rows = await this.prisma.chatMessage.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit,
    });
    return rows.map(toMessage);
  }
  async updateMessage(
    id: string,
    patch: Partial<Pick<ChatMessageRecord, "body" | "reactions" | "mentions" | "editedAt" | "deletedAt" | "attachments" | "link">>,
  ): Promise<ChatMessageRecord | undefined> {
    const data: Prisma.ChatMessageUncheckedUpdateInput = {};
    if (patch.attachments !== undefined) data.attachments = json(patch.attachments);
    if (patch.link !== undefined) data.link = patch.link ? json(patch.link) : Prisma.DbNull;
    if (patch.body !== undefined) data.body = patch.body;
    if (patch.reactions !== undefined) data.reactions = json(patch.reactions);
    if (patch.mentions !== undefined) data.mentions = json(patch.mentions);
    if (patch.editedAt !== undefined) data.editedAt = date(patch.editedAt);
    if (patch.deletedAt !== undefined) data.deletedAt = date(patch.deletedAt);
    const n = await this.prisma.chatMessage.updateMany({ where: { id }, data });
    return n.count ? this.getMessage(id) : undefined;
  }
  async lastMessages(rooms: Array<{ roomId: string; from: string | null }>): Promise<Map<string, ChatMessageRecord>> {
    const out = new Map<string, ChatMessageRecord>();
    await Promise.all(
      rooms.map(async (r) => {
        const [m] = await this.listMessages(r.roomId, { from: r.from, limit: 1 });
        if (m) out.set(r.roomId, m);
      }),
    );
    return out;
  }
  async unreadCounts(
    userId: string,
    rooms: Array<{ roomId: string; since: string | null; from: string | null }>,
  ): Promise<Map<string, { unread: number; mentioned: boolean }>> {
    const out = new Map<string, { unread: number; mentioned: boolean }>();
    await Promise.all(
      rooms.map(async (r) => {
        const createdAt: Prisma.DateTimeFilter = {};
        if (r.since) createdAt.gt = new Date(r.since);
        if (r.from) createdAt.gte = new Date(r.from);
        const where: Prisma.ChatMessageWhereInput = {
          roomId: r.roomId,
          kind: "text",
          deletedAt: null,
          OR: [{ authorUserId: null }, { authorUserId: { not: userId } }],
          createdAt,
        };
        const unread = await this.prisma.chatMessage.count({ where });
        const mentioned = unread
          ? (await this.prisma.chatMessage.count({ where: { ...where, mentions: { array_contains: [userId] } } })) > 0
          : false;
        out.set(r.roomId, { unread, mentioned });
      }),
    );
    return out;
  }

  async searchMessages(roomIds: string[], q: string, limit: number): Promise<ChatMessageRecord[]> {
    if (!roomIds.length) return [];
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId: { in: roomIds }, kind: "text", deletedAt: null, body: { contains: q, mode: "insensitive" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(toMessage);
  }

  async setStar(userId: string, messageId: string, starred: boolean): Promise<void> {
    if (starred) {
      await this.prisma.chatStar.upsert({
        where: { userId_chatMessageId: { userId, chatMessageId: messageId } },
        create: { userId, chatMessageId: messageId, createdAt: new Date(chatClock()) },
        update: {},
      });
    } else {
      await this.prisma.chatStar.deleteMany({ where: { userId, chatMessageId: messageId } });
    }
  }
  async starsOf(userId: string): Promise<Array<{ messageId: string; at: string }>> {
    const rows = await this.prisma.chatStar.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500 });
    return rows.map((r) => ({ messageId: r.chatMessageId, at: r.createdAt.toISOString() }));
  }

  async addAudit(roomId: string, userId: string): Promise<void> {
    await this.prisma.chatAudit.create({ data: { roomId, userId, at: new Date(chatClock()) } });
  }
  async listAudits(roomId: string): Promise<Array<{ userId: string; at: string }>> {
    const rows = await this.prisma.chatAudit.findMany({ where: { roomId }, orderBy: { at: "desc" } });
    return rows.map((a) => ({ userId: a.userId, at: a.at.toISOString() }));
  }

  async setLastSeen(userId: string, at: string): Promise<void> {
    await this.prisma.chatPresence.upsert({
      where: { userId },
      create: { userId, lastSeenAt: new Date(at) },
      update: { lastSeenAt: new Date(at) },
    });
  }
  async lastSeen(userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();
    const rows = await this.prisma.chatPresence.findMany({ where: { userId: { in: userIds } } });
    return new Map(rows.map((r) => [r.userId, r.lastSeenAt.toISOString()]));
  }
}
