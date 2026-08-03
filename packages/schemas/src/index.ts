/**
 * @ding/schemas — the single source of truth for domain types and the
 * realtime event contract, shared by the API and the web app.
 *
 * Everything is a Zod schema first; TypeScript types are inferred from it,
 * so validation and types can never drift apart.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const ChannelType = {
  WhatsApp: "whatsapp",
  WhatsAppGroup: "whatsapp_group",
  Email: "email",
} as const;
export const channelTypeSchema = z.enum(["whatsapp", "whatsapp_group", "email"]);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const conversationStatusSchema = z.enum(["open", "pending", "snoozed", "closed"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const messageDirectionSchema = z.enum(["in", "out"]);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const messageStatusSchema = z.enum(["queued", "sent", "delivered", "read", "failed"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const authorTypeSchema = z.enum(["contact", "user", "system"]);
export type AuthorType = z.infer<typeof authorTypeSchema>;

export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type Priority = z.infer<typeof prioritySchema>;

export const roleSchema = z.enum(["admin", "manager", "agent"]);
export type Role = z.infer<typeof roleSchema>;

/** How an inbox/team turns inbound conversations into assignments. */
export const routingStrategySchema = z.enum([
  "manual", // stays "up for grabs" until an agent takes it
  "round_robin",
  "load_balanced",
  "most_idle",
]);
export type RoutingStrategy = z.infer<typeof routingStrategySchema>;

/* ------------------------------------------------------------------ */
/* Core entities                                                       */
/* ------------------------------------------------------------------ */

export const userSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: roleSchema,
  avatarColor: z.string().optional(),
  online: z.boolean().default(false),
});
export type User = z.infer<typeof userSchema>;

export const teamSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

export const contactSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  displayName: z.string(),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  avatarColor: z.string().optional(),
});
export type Contact = z.infer<typeof contactSchema>;

export const inboxSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  type: channelTypeSchema,
  name: z.string(),
  /** Human handle: a phone number, group name, or email address. */
  handle: z.string(),
  teamIds: z.array(z.string()).default([]),
  routingStrategy: routingStrategySchema.default("manual"),
  unread: z.number().int().nonnegative().default(0),
});
export type Inbox = z.infer<typeof inboxSchema>;

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type Label = z.infer<typeof labelSchema>;

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  seq: z.number().int().nonnegative(),
  direction: messageDirectionSchema,
  authorType: authorTypeSchema,
  authorName: z.string().optional(),
  body: z.string(),
  status: messageStatusSchema.default("sent"),
  /** Internal-lane note — never delivered to the customer. */
  internal: z.boolean().default(false),
  createdAt: z.string(), // ISO-8601
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  inboxId: z.string(),
  channel: channelTypeSchema,
  contact: contactSchema,
  status: conversationStatusSchema.default("open"),
  assigneeUserId: z.string().nullable().default(null),
  assignedTeamId: z.string().nullable().default(null),
  priority: prioritySchema.default("normal"),
  labels: z.array(labelSchema).default([]),
  unread: z.boolean().default(false),
  slaDueAt: z.string().nullable().default(null),
  lastActivityAt: z.string(),
  seq: z.number().int().nonnegative().default(0),
  preview: z.string().default(""),
});
export type Conversation = z.infer<typeof conversationSchema>;

/** A conversation plus its messages — the thread view payload. */
export const conversationWithMessagesSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
});
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

/* ------------------------------------------------------------------ */
/* API request payloads                                                */
/* ------------------------------------------------------------------ */

export const sendMessageInputSchema = z.object({
  body: z.string().min(1),
  internal: z.boolean().default(false),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const assignConversationInputSchema = z.object({
  assigneeUserId: z.string().nullable().optional(),
  assignedTeamId: z.string().nullable().optional(),
});
export type AssignConversationInput = z.infer<typeof assignConversationInputSchema>;

/* ------------------------------------------------------------------ */
/* Realtime event contract (Socket.IO)                                 */
/* ------------------------------------------------------------------ */

/** Event names the server emits to clients. */
export const ServerEvent = {
  MessageCreated: "message.created",
  MessageUpdated: "message.updated",
  ConversationUpdated: "conversation.updated",
  ConversationAssigned: "conversation.assigned",
  Typing: "typing",
  Presence: "presence",
  InboxCounts: "inbox.counts",
} as const;
export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent];

export interface ServerToClientEvents {
  [ServerEvent.MessageCreated]: (p: { conversationId: string; message: Message }) => void;
  [ServerEvent.MessageUpdated]: (p: { conversationId: string; message: Message }) => void;
  [ServerEvent.ConversationUpdated]: (p: { conversation: Conversation }) => void;
  [ServerEvent.ConversationAssigned]: (p: {
    conversation: Conversation;
    by?: string;
    reason?: string;
  }) => void;
  [ServerEvent.Typing]: (p: { conversationId: string; who: string; typing: boolean }) => void;
  [ServerEvent.Presence]: (p: { userId: string; online: boolean }) => void;
  [ServerEvent.InboxCounts]: (p: { inboxId: string; unread: number }) => void;
}

/** Event names / payloads the client emits to the server. */
export const ClientEvent = {
  JoinConversation: "conversation:join",
  LeaveConversation: "conversation:leave",
  Typing: "typing",
} as const;

export interface ClientToServerEvents {
  [ClientEvent.JoinConversation]: (p: { conversationId: string }) => void;
  [ClientEvent.LeaveConversation]: (p: { conversationId: string }) => void;
  [ClientEvent.Typing]: (p: { conversationId: string; typing: boolean }) => void;
}
