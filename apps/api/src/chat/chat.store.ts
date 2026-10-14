import type { ChatAttachment, ChatLinkPreview, ChatMemberRole, ChatRoomKind, ChatSharedConversation, ChatSystemData } from "@ding/schemas";

export interface ChatRoomRecord {
  id: string;
  kind: ChatRoomKind;
  name: string;
  emoji: string | null;
  teamId: string | null;
  directKey: string | null;
  createdById: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export type ChatRoomFields = Pick<ChatRoomRecord, "kind" | "name" | "emoji" | "teamId" | "directKey" | "createdById">;

export interface ChatMemberRecord {
  roomId: string;
  userId: string;
  role: ChatMemberRole;
  joinedAt: string;
  lastReadAt: string | null;
  lastDeliveredAt: string | null;
  mutedUntil: string | null;
  pinnedAt: string | null;
}

export type ChatMemberPatch = Partial<Omit<ChatMemberRecord, "roomId" | "userId">>;

export interface ChatMessageRecord {
  id: string;
  roomId: string;
  authorUserId: string | null;
  kind: "text" | "system";
  body: string;
  data: ChatSystemData | null;
  replyToId: string | null;
  /** emoji → who reacted with it */
  reactions: Record<string, string[]>;
  mentions: string[];
  attachments: ChatAttachment[];
  link: ChatLinkPreview | null;
  /** A customer conversation shared into the chat, and its card as it was then. */
  conversationId: string | null;
  shared: ChatSharedConversation | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export type ChatMessageFields = Pick<ChatMessageRecord, "roomId" | "authorUserId" | "kind" | "body" | "data" | "replyToId" | "mentions"> &
  Partial<Pick<ChatMessageRecord, "attachments" | "conversationId" | "shared">>;

/** Where to read from, and how far back. */
export interface ChatPageQuery {
  /** Older than this message (scrolling back). */
  before?: { id: string; createdAt: string };
  /** Nothing from before this — when someone joined a group. */
  from?: string | null;
  limit: number;
}

/**
 * Where Team Chat lives. Its own store beside the core one, as Business Ops
 * and macros are: Postgres scoped to the bound workspace, and in memory for dev
 * and the checks. See docs/team-chat.md.
 */
export abstract class ChatStore {
  abstract getRoom(id: string): Promise<ChatRoomRecord | undefined>;
  abstract roomByDirectKey(key: string): Promise<ChatRoomRecord | undefined>;
  abstract roomByTeam(teamId: string): Promise<ChatRoomRecord | undefined>;
  /** Every chat in the workspace, or just these. */
  abstract listRooms(ids?: string[]): Promise<ChatRoomRecord[]>;
  abstract createRoom(f: ChatRoomFields): Promise<ChatRoomRecord>;
  abstract updateRoom(id: string, patch: Partial<Pick<ChatRoomRecord, "name" | "emoji" | "teamId">>): Promise<ChatRoomRecord | undefined>;

  abstract listMembers(roomId: string): Promise<ChatMemberRecord[]>;
  abstract membershipsOf(userId: string): Promise<ChatMemberRecord[]>;
  abstract getMember(roomId: string, userId: string): Promise<ChatMemberRecord | undefined>;
  /** Creates the row if it isn't there; `patch` applies either way. */
  abstract upsertMember(roomId: string, userId: string, patch?: ChatMemberPatch): Promise<ChatMemberRecord>;
  abstract removeMember(roomId: string, userId: string): Promise<boolean>;

  /** Also moves the chat to the top of everyone's list. */
  abstract createMessage(f: ChatMessageFields): Promise<ChatMessageRecord>;
  abstract getMessage(id: string): Promise<ChatMessageRecord | undefined>;
  abstract getMessages(ids: string[]): Promise<ChatMessageRecord[]>;
  /** Newest first. */
  abstract listMessages(roomId: string, q: ChatPageQuery): Promise<ChatMessageRecord[]>;
  abstract updateMessage(
    id: string,
    patch: Partial<Pick<ChatMessageRecord, "body" | "reactions" | "mentions" | "editedAt" | "deletedAt" | "attachments" | "link" | "conversationId" | "shared">>,
  ): Promise<ChatMessageRecord | undefined>;
  /** Text messages in these chats whose words contain `q`, newest first. */
  abstract searchMessages(roomIds: string[], q: string, limit: number): Promise<ChatMessageRecord[]>;

  /** The chats this person has written in (oversight: ones they stepped into). */
  abstract roomsWrittenIn(userId: string): Promise<string[]>;
  /** Everyone who has written in this chat. */
  abstract authorsIn(roomId: string): Promise<string[]>;
  /** The cards a customer conversation has made, in any chat — not deleted, newest first. */
  abstract sharesOf(conversationId: string): Promise<ChatMessageRecord[]>;
  /** Text messages replying to any of these, oldest first. */
  abstract repliesTo(messageIds: string[]): Promise<ChatMessageRecord[]>;

  abstract setStar(userId: string, messageId: string, starred: boolean): Promise<void>;
  /** Newest first. */
  abstract starsOf(userId: string): Promise<Array<{ messageId: string; at: string }>>;
  /** The newest message in each of these chats, from `from` on where given. */
  abstract lastMessages(rooms: Array<{ roomId: string; from: string | null }>): Promise<Map<string, ChatMessageRecord>>;
  /**
   * For each chat: messages from others after `since` (and not before `from`),
   * not deleted — and whether any of them mention this person.
   */
  abstract unreadCounts(
    userId: string,
    rooms: Array<{ roomId: string; since: string | null; from: string | null }>,
  ): Promise<Map<string, { unread: number; mentioned: boolean }>>;

  abstract addAudit(roomId: string, userId: string): Promise<void>;
  abstract listAudits(roomId: string): Promise<Array<{ userId: string; at: string }>>;

  abstract setLastSeen(userId: string, at: string): Promise<void>;
  abstract lastSeen(userIds: string[]): Promise<Map<string, string>>;
}
