import { z } from "zod";
import { attachmentSchema, type Attachment, type ChannelType, type ConversationStatus } from "./index";

/*
 * Team Chat — the team talking to itself.
 *
 * Direct messages between two people, groups that managers and admins set up,
 * and one group per team whose members are simply the team. Deliberately shaped
 * like WhatsApp: a list of chats, bubbles, ticks, replies and reactions — the
 * thing everyone already knows how to use. Switched on per workspace.
 *
 * Who has read what is kept as one marker per person per chat ("read up to
 * here"), not a row per message per person. A message's ticks are worked out
 * from the markers of everyone else in the chat, which costs nothing however
 * big the group gets. See docs/team-chat.md.
 */

export const CHAT_ROOM_KINDS = ["direct", "group", "team"] as const;
export const chatRoomKindSchema = z.enum(CHAT_ROOM_KINDS);
export type ChatRoomKind = z.infer<typeof chatRoomKindSchema>;

export const chatMemberRoleSchema = z.enum(["admin", "member"]);
export type ChatMemberRole = z.infer<typeof chatMemberRoleSchema>;

/** How long after sending a message its author can still change it. */
export const CHAT_EDIT_WINDOW_MS = 15 * 60_000;
export const CHAT_MESSAGE_MAX = 4000;
export const CHAT_GROUP_NAME_MAX = 60;
/** Messages per page when scrolling back. */
export const CHAT_PAGE_SIZE = 50;

/** A person as chat shows them. */
export interface ChatPerson {
  id: string;
  name: string;
  avatarColor: string | null;
  avatarUrl: string | null;
}

/** Someone in a chat, with how far they've got through it. */
export interface ChatMember extends ChatPerson {
  role: ChatMemberRole;
  /** Read everything up to here. Null: hasn't opened it. */
  lastReadAt: string | null;
  /** Their app has received everything up to here. */
  lastDeliveredAt: string | null;
  online: boolean;
  lastSeenAt: string | null;
}

/** What happened, for the grey centred lines ("Nathan added Amara"). */
export const CHAT_SYSTEM_EVENTS = ["created", "added", "removed", "left", "renamed", "emoji", "promoted", "demoted"] as const;
export type ChatSystemEvent = (typeof CHAT_SYSTEM_EVENTS)[number];

export interface ChatSystemData {
  event: ChatSystemEvent;
  /** Who did it. */
  actorName: string;
  /** Who it was done to (added, removed, promoted…). */
  targetNames?: string[];
  /** The new name or emoji. */
  value?: string;
}

/** The message a reply is quoting, as much of it as the bubble needs. */
export interface ChatQuote {
  id: string;
  authorId: string | null;
  authorName: string;
  /** Trimmed; empty when the quoted message has since been deleted. */
  body: string;
  deleted: boolean;
}

/** The card under a message that carries a link: what the page says it is. */
export interface ChatLinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
}

/** Photos, voice notes, files — the same shape the inbox uses. */
export type ChatAttachment = Attachment;
export const CHAT_MAX_ATTACHMENTS = 10;

export interface ChatReaction {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: string;
  roomId: string;
  kind: "text" | "system";
  author: ChatPerson | null;
  /** Mentions stay as handles ("@nathan"), as in notes; shown by name. */
  body: string;
  system: ChatSystemData | null;
  replyTo: ChatQuote | null;
  reactions: ChatReaction[];
  attachments: ChatAttachment[];
  /** A preview of the first link in it, once fetched. */
  link: ChatLinkPreview | null;
  /** A customer conversation brought into the chat to discuss ("Discuss…"). */
  shared: ChatSharedConversation | null;
  /** Who it @-mentions, resolved when it was sent. */
  mentions: string[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Echoed back from the sender, so their optimistic bubble can be swapped for the real one. */
  clientId?: string | null;
}

/** One row in the list of chats. */
export interface ChatRoomSummary {
  id: string;
  kind: ChatRoomKind;
  /** A group's name; for a direct message, the other person's. */
  name: string;
  emoji: string | null;
  teamId: string | null;
  /** The other person, in a direct message. */
  other: (ChatPerson & { online: boolean; lastSeenAt: string | null }) | null;
  memberCount: number;
  lastMessage: ChatMessage | null;
  lastActivityAt: string;
  unread: number;
  /** An unread message mentions me. */
  mentioned: boolean;
  pinned: boolean;
  muted: boolean;
  /** I'm in it. False only for an admin or manager reading someone else's chat. */
  isMember: boolean;
  /** Not in it, but following it: an admin or manager who has written there.
   *  It sits in their list with unread and notifications, and can be muted
   *  or taken off the list (leave). */
  watching: boolean;
  /** The team behind a team chat has been deleted; it's kept, read-only. */
  archived: boolean;
}

/** A chat, opened. */
export interface ChatRoom extends ChatRoomSummary {
  members: ChatMember[];
  myRole: ChatMemberRole | null;
  /** Rename, change the emoji, add and remove people. */
  canManage: boolean;
  canPost: boolean;
  canLeave: boolean;
  /** An admin reading a chat they aren't in. */
  oversight: boolean;
  createdAt: string;
}

export interface ChatMessagePage {
  /** Oldest first. */
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface ChatStatusInfo {
  enabled: boolean;
  /** Admins and managers. */
  canCreateGroups: boolean;
  /** Admins: read any chat. */
  canOversee: boolean;
  /** Unread messages across my chats (muted chats left out). */
  unread: number;
}

/** "Info" on one of my messages: who has read it, who only has it. */
export interface ChatMessageInfo {
  readBy: Array<{ person: ChatPerson; at: string }>;
  deliveredTo: Array<{ person: ChatPerson; at: string }>;
  waiting: ChatPerson[];
}

/* ---- inputs ---- */

const body = z.string().trim().min(1, "Write something").max(CHAT_MESSAGE_MAX);
const emoji = z.string().trim().min(1).max(16);

export const sendChatMessageInputSchema = z
  .object({
    /** May be empty when the message is only a photo, a voice note or a file. */
    body: z.string().trim().max(CHAT_MESSAGE_MAX).default(""),
    /** As the upload returned them; the server checks each against its own records. */
    // Lazy: index.ts loads this file before it defines attachmentSchema.
    attachments: z.array(z.lazy(() => attachmentSchema)).max(CHAT_MAX_ATTACHMENTS).default([]),
    replyToId: z.string().nullable().optional(),
    /** The sender's own id for the bubble they're showing while it sends. */
    clientId: z.string().max(64).nullable().optional(),
  })
  .refine((v) => v.body.length > 0 || v.attachments.length > 0, { message: "Write something", path: ["body"] });
export type SendChatMessageInput = z.infer<typeof sendChatMessageInputSchema>;

export const starChatMessageInputSchema = z.object({ starred: z.boolean() });

/* ---- customer conversations, discussed ---- */

/**
 * The card a shared customer conversation makes in a chat. Who, on which
 * channel and about what are kept as they were when it was shared; its status
 * and who has it are read fresh, and follow the conversation live.
 */
export interface ChatSharedConversation {
  conversationId: string;
  contactName: string;
  contactAvatarColor: string | null;
  channel: ChannelType;
  subject: string | null;
  /** Null once the conversation itself has gone. */
  status: ConversationStatus | null;
  assigneeName: string | null;
  /** The one message it was shared from, if it was ("Discuss…" on a message, or a note sent on). */
  quote: { messageId: string; authorName: string; body: string; internal: boolean; at: string } | null;
}

export const shareConversationInputSchema = z.object({
  roomId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1).nullish(),
  /** A line to go with it: "Can someone check stock for this?" */
  body: z.string().max(CHAT_MESSAGE_MAX).default(""),
});
export type ShareConversationInput = z.infer<typeof shareConversationInputSchema>;

/** Where a customer conversation is being discussed: the card, and the replies to it. */
export interface ChatDiscussion {
  roomId: string;
  roomName: string;
  roomKind: ChatRoomKind;
  canPost: boolean;
  card: ChatMessage;
  replies: number;
  latest: ChatMessage | null;
}

/** One discussion, in full: the card and everything said in reply to it. */
export interface ChatDiscussionThread extends Omit<ChatDiscussion, "latest" | "replies"> {
  replies: ChatMessage[];
}

/** A message I starred, with where it is. */
export interface ChatStarred {
  roomId: string;
  roomName: string;
  message: ChatMessage;
  starredAt: string;
}

/** A message found by search, with where it is. */
export interface ChatSearchHit {
  roomId: string;
  roomName: string;
  roomKind: ChatRoomKind;
  message: ChatMessage;
}

export const editChatMessageInputSchema = z.object({ body });
export type EditChatMessageInput = z.infer<typeof editChatMessageInputSchema>;

/** Toggle: the same emoji again takes it off; another replaces mine. */
export const reactChatMessageInputSchema = z.object({ emoji: z.string().max(16) });
export type ReactChatMessageInput = z.infer<typeof reactChatMessageInputSchema>;

export const openDirectChatInputSchema = z.object({ userId: z.string().min(1) });
export type OpenDirectChatInput = z.infer<typeof openDirectChatInputSchema>;

export const createChatGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name").max(CHAT_GROUP_NAME_MAX),
  emoji: emoji.nullable().optional(),
  memberIds: z.array(z.string()).max(500).default([]),
});
export type CreateChatGroupInput = z.infer<typeof createChatGroupInputSchema>;

export const updateChatGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(CHAT_GROUP_NAME_MAX).optional(),
  emoji: emoji.nullable().optional(),
});
export type UpdateChatGroupInput = z.infer<typeof updateChatGroupInputSchema>;

export const addChatMembersInputSchema = z.object({ userIds: z.array(z.string()).min(1).max(500) });
export type AddChatMembersInput = z.infer<typeof addChatMembersInputSchema>;

export const setChatMemberRoleInputSchema = z.object({ role: chatMemberRoleSchema });
export type SetChatMemberRoleInput = z.infer<typeof setChatMemberRoleInputSchema>;

/** My own settings for one chat. */
export const chatRoomPrefsInputSchema = z.object({
  muted: z.boolean().optional(),
  pinned: z.boolean().optional(),
});
export type ChatRoomPrefsInput = z.infer<typeof chatRoomPrefsInputSchema>;

export const setChatModuleInputSchema = z.object({ enabled: z.boolean() });

/* ---- live events (Socket.IO) ---- */

export const ChatServerEvent = {
  /** A new message, to everyone in the chat. */
  Message: "chat.message",
  /** A message edited, deleted or reacted to. */
  MessageUpdated: "chat.message.updated",
  /** Someone's read or delivered marker moved — ticks change. */
  Receipt: "chat.receipt",
  /** The chat itself changed: created, renamed, people added or removed. */
  Room: "chat.room",
  Typing: "chat.typing",
  /** Someone came online or went offline. */
  Presence: "chat.presence",
  /** "Make a sound": only to the people the notification rules picked. */
  Cue: "chat.cue",
} as const;

export const ChatClientEvent = {
  /** I have this chat open (so don't push me about it). */
  Join: "chat:join",
  Leave: "chat:leave",
  Typing: "chat:typing",
} as const;

export interface ChatServerEvents {
  [ChatServerEvent.Message]: (p: { roomId: string; message: ChatMessage }) => void;
  [ChatServerEvent.MessageUpdated]: (p: { roomId: string; message: ChatMessage }) => void;
  [ChatServerEvent.Receipt]: (p: { roomId: string; userId: string; lastReadAt: string | null; lastDeliveredAt: string | null }) => void;
  [ChatServerEvent.Room]: (p: { roomId: string; removed?: boolean }) => void;
  [ChatServerEvent.Typing]: (p: { roomId: string; userId: string; name: string; typing: boolean }) => void;
  [ChatServerEvent.Presence]: (p: { userId: string; online: boolean; lastSeenAt: string | null }) => void;
  [ChatServerEvent.Cue]: (p: { roomId: string; mention: boolean }) => void;
}

export interface ChatClientEvents {
  [ChatClientEvent.Join]: (p: { roomId: string }) => void;
  [ChatClientEvent.Leave]: (p: { roomId: string }) => void;
  [ChatClientEvent.Typing]: (p: { roomId: string; typing: boolean }) => void;
}

/* ---- shared rules, so the server and every screen agree ---- */

/** One key per pair of people, whichever of them starts it. */
export function directChatKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export type ChatTicks = "sent" | "delivered" | "read";

/**
 * A message's ticks, for its author: blue when everyone else in the chat has
 * read past it, two grey when everyone's app has it, one grey otherwise.
 * A chat with nobody else in it (everyone left) stays at one tick.
 */
export function chatTicks(message: Pick<ChatMessage, "createdAt">, members: ChatMember[], authorId: string): ChatTicks {
  const others = members.filter((m) => m.id !== authorId);
  if (!others.length) return "sent";
  const at = message.createdAt;
  if (others.every((m) => m.lastReadAt && m.lastReadAt >= at)) return "read";
  if (others.every((m) => (m.lastDeliveredAt && m.lastDeliveredAt >= at) || (m.lastReadAt && m.lastReadAt >= at))) {
    return "delivered";
  }
  return "sent";
}

export function canEditChatMessage(m: Pick<ChatMessage, "createdAt" | "deletedAt" | "kind">, now = Date.now()): boolean {
  return m.kind === "text" && !m.deletedAt && now - new Date(m.createdAt).getTime() < CHAT_EDIT_WINDOW_MS;
}

/** The grey line for a system message, from where the reader sits. */
export function chatSystemText(s: ChatSystemData): string {
  const who = s.actorName;
  const them = joinNames(s.targetNames ?? []);
  switch (s.event) {
    case "created":
      return s.value ? `${who} created the group “${s.value}”` : `${who} created this group`;
    case "added":
      return `${who} added ${them}`;
    case "removed":
      return `${who} removed ${them}`;
    case "left":
      return `${who} left`;
    case "renamed":
      return `${who} renamed the group to “${s.value ?? ""}”`;
    case "emoji":
      return s.value ? `${who} changed the group icon to ${s.value}` : `${who} removed the group icon`;
    case "promoted":
      return `${who} made ${them} a group admin`;
    case "demoted":
      return `${who} removed ${them} as a group admin`;
  }
}

/** What a message with no words says in a list or a push: "📷 Photo", "🎤 Voice message (0:12)". */
export function chatAttachmentLabel(atts: Array<Pick<Attachment, "kind" | "filename" | "durationMs">>): string {
  const a = atts[0];
  if (!a) return "";
  const more = atts.length > 1 ? ` +${atts.length - 1}` : "";
  const secs = a.durationMs ? Math.round(a.durationMs / 1000) : 0;
  const dur = secs ? ` (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")})` : "";
  switch (a.kind) {
    case "image":
    case "sticker":
      return atts.length > 1 && atts.every((x) => x.kind === "image") ? `📷 ${atts.length} photos` : `📷 Photo${more}`;
    case "video":
      return `🎥 Video${dur}${more}`;
    case "voice":
      return `🎤 Voice message${dur}`;
    case "audio":
      return `🎵 Audio${dur}${more}`;
    default:
      return `📄 ${a.filename || "File"}${more}`;
  }
}

/** How a shared customer conversation reads in a list or a push: "💬 Golden Screen". */
export function chatSharedLabel(s: Pick<ChatSharedConversation, "contactName">): string {
  return `💬 ${s.contactName}`;
}

/** "Amara", "Amara and James", "Amara, James and Sam". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The short "@handle" tokens in a body, lower-cased; "@nathan." still means @nathan. */
export function chatMentionTokens(body: string): Set<string> {
  return new Set((body.toLowerCase().match(/@[\w.+-]+/g) ?? []).map((t) => t.replace(/[.+-]+$/, "")));
}
