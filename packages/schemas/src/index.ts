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

export const messageStatusSchema = z.enum(["queued", "sending", "sent", "delivered", "read", "failed"]);
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
  /** Icon key from the shared team-icon library (see web lib/icons). */
  icon: z.string().nullable().optional(),
  /** Sort position in Settings and the sidebar (ascending). */
  order: z.number().int().default(0),
  /** First-response SLA target in minutes; null = no SLA for this team. */
  slaMinutes: z.number().int().positive().nullable().optional(),
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
  /** Free-form labels for organising customers (VIP, Wholesale, …). */
  tags: z.array(z.string()).default([]),
  /** Owner drives per-customer auto-routing (a client always reaches "their" person/team). */
  ownerUserId: z.string().nullable().optional(),
  ownerTeamId: z.string().nullable().optional(),
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
  /** True once the integration credentials needed to send/receive live are set. */
  connected: z.boolean().optional(),
});
export type Inbox = z.infer<typeof inboxSchema>;

/**
 * The channelConfig keys that must be present (and non-empty) before an inbox
 * of a given type can send/receive live. Used to derive `connected`. Secrets in
 * channelConfig never leave the backend — only the boolean does.
 */
export const REQUIRED_CHANNEL_KEYS: Record<ChannelType, string[]> = {
  whatsapp: ["phoneNumberId", "accessToken"],
  whatsapp_group: ["phoneNumberId", "accessToken"],
  email: ["providerToken"],
};

/**
 * Whether an inbox is wired up to its provider. A `null`/absent config means a
 * legacy/demo channel that predates the integration flow — treated as connected
 * so existing inboxes don't suddenly read as broken. A present config (even `{}`)
 * is checked strictly against REQUIRED_CHANNEL_KEYS.
 */
export function isInboxConnected(
  type: ChannelType,
  config?: Record<string, string> | null,
): boolean {
  if (config == null) return true;
  const keys = REQUIRED_CHANNEL_KEYS[type] ?? [];
  return keys.every((k) => Boolean(config[k] && config[k].trim()));
}

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type Label = z.infer<typeof labelSchema>;

/** What a message carries. "text" is the default; the rest imply attachments. */
export const messageTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "voice",
  "document",
  "sticker",
  "location",
  "contact",
]);
export type MessageType = z.infer<typeof messageTypeSchema>;

export const attachmentKindSchema = z.enum([
  "image",
  "video",
  "audio",
  "voice",
  "document",
  "sticker",
  "file",
]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

/** A stored media file on a message. `url` is a same-origin served/download link;
 *  the underlying storage key never reaches the client. */
export const attachmentSchema = z.object({
  id: z.string(),
  kind: attachmentKindSchema,
  mime: z.string(),
  size: z.number().int().nonnegative(),
  filename: z.string(),
  url: z.string(),
  /** Audio/video duration (ms), image intrinsic size, voice waveform peaks (0..1). */
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  waveform: z.array(z.number()).optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** An emoji reaction on a message, by the customer ("contact") or an agent ("user"). */
export const reactionSchema = z.object({
  emoji: z.string(),
  by: z.enum(["contact", "user"]),
});
export type Reaction = z.infer<typeof reactionSchema>;

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
  /** Provider-side id (e.g. WhatsApp wamid) for reconciling delivery/read status. */
  channelMsgId: z.string().nullable().optional(),
  /** The channel this message was sent/received on (a thread can span channels).
   *  Absent → the conversation's own channel. */
  channel: channelTypeSchema.nullable().optional(),
  /** What the message carries; "text" unless it has media. */
  messageType: messageTypeSchema.default("text"),
  /** Media files attached to the message (images, files, voice notes, …). */
  attachments: z.array(attachmentSchema).default([]),
  /** Sanitized HTML body for rich email (rendered in a sandboxed iframe). The
   *  plain `body` above stays the fallback + list-preview text. */
  bodyHtml: z.string().nullable().optional(),
  /** Emoji reactions on this message (at most one per participant). */
  reactions: z.array(reactionSchema).default([]),
  /** Id of the message this one quotes/replies to (resolved within the thread). */
  quotedMsgId: z.string().nullable().optional(),
  /** Outbound send attempts made so far (absent for inbound/internal). */
  attemptCount: z.number().int().nonnegative().optional(),
  /** Human-readable reason shown in the UI once an outbound send has failed. */
  failureReason: z.string().nullable().optional(),
  createdAt: z.string(), // ISO-8601
});
export type Message = z.infer<typeof messageSchema>;

/** Official WhatsApp Groups API cap: a group holds at most 8 members. */
export const GROUP_MAX_MEMBERS = 8;

export const participantRoleSchema = z.enum(["member", "admin"]);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

export const participantSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  contact: contactSchema,
  role: participantRoleSchema.default("member"),
  joinedAt: z.string(),
});
export type Participant = z.infer<typeof participantSchema>;

/** WhatsApp 24-hour customer-service window state on a conversation. */
export const waWindowSchema = z.object({
  open: z.boolean(),
  /** ISO time an open window closes (24h after the last inbound); null if never opened. */
  expiresAt: z.string().nullable(),
});
export type WaWindow = z.infer<typeof waWindowSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  inboxId: z.string(),
  channel: channelTypeSchema,
  contact: contactSchema,
  /** Email thread subject / group name. */
  subject: z.string().nullable().optional(),
  /** Group invite link (whatsapp_group only). */
  inviteLink: z.string().nullable().optional(),
  /** Provider-side reference: the WhatsApp group id (whatsapp_group only). */
  channelRef: z.string().nullable().optional(),
  status: conversationStatusSchema.default("open"),
  assigneeUserId: z.string().nullable().default(null),
  assignedTeamId: z.string().nullable().default(null),
  priority: prioritySchema.default("normal"),
  labels: z.array(labelSchema).default([]),
  unread: z.boolean().default(false),
  /** Number of unread inbound messages (for the WhatsApp-style count badge). */
  unreadCount: z.number().int().nonnegative().default(0),
  slaDueAt: z.string().nullable().default(null),
  /** When a snoozed conversation should wake back into the queue (ISO). */
  snoozedUntil: z.string().nullable().default(null),
  lastActivityAt: z.string(),
  seq: z.number().int().nonnegative().default(0),
  preview: z.string().default(""),
  /**
   * WhatsApp's 24-hour customer-service window (whatsapp channels only; null on
   * email). `open` = you may free-type; when closed you may only send an
   * approved template. `expiresAt` is when an open window closes (ISO).
   */
  waWindow: waWindowSchema.nullable().default(null),
});
export type Conversation = z.infer<typeof conversationSchema>;

/** A conversation plus its (most-recent page of) messages — the thread payload. */
export const conversationWithMessagesSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
  /** True when older messages exist beyond the returned page (load on scroll-up). */
  hasMoreMessages: z.boolean().default(false),
  /** Group members (whatsapp_group only; empty otherwise). */
  participants: z.array(participantSchema).default([]),
});
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

/* ------------------------------------------------------------------ */
/* Cursor pagination                                                   */
/* ------------------------------------------------------------------ */

/** A page of conversations (list/search). `nextCursor` is null on the last page. */
export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable().default(null),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;

/** A page of older thread messages (scroll-up history). */
export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable().default(null),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

/** Default page sizes shared by the API and the client. */
export const CONVERSATIONS_PAGE_SIZE = 30;
export const MESSAGES_PAGE_SIZE = 40;

/* ------------------------------------------------------------------ */
/* API request payloads                                                */
/* ------------------------------------------------------------------ */

/* ---- WhatsApp message templates (HSM) ---- */

export const templateCategorySchema = z.enum(["marketing", "utility", "authentication"]);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;

/** Meta's template review states, plus our local "draft" for unsynced ones. */
export const templateApprovalSchema = z.enum([
  "approved",
  "pending",
  "rejected",
  "paused",
  "disabled",
  "draft",
]);
export type TemplateApproval = z.infer<typeof templateApprovalSchema>;

export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: templateCategorySchema,
  /** BCP-47-ish language code, e.g. "en" or "en_GB". */
  language: z.string(),
  /** Body text with {{1}}, {{2}} … positional variables. */
  body: z.string(),
  approvalStatus: templateApprovalSchema,
  /** How many {{n}} variables the body has (derived; drives the fill form). */
  variableCount: z.number().int().nonnegative().default(0),
});
export type Template = z.infer<typeof templateSchema>;

export const createTemplateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "Use lower-case letters, numbers and underscores only"),
  category: templateCategorySchema.default("utility"),
  language: z.string().min(2).default("en"),
  body: z.string().min(1),
});
export type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "Use lower-case letters, numbers and underscores only")
    .optional(),
  category: templateCategorySchema.optional(),
  language: z.string().min(2).optional(),
  body: z.string().min(1).optional(),
  approvalStatus: templateApprovalSchema.optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateInputSchema>;

export const sendMessageInputSchema = z
  .object({
    body: z.string().default(""),
    internal: z.boolean().default(false),
    /** Ids of previously-uploaded attachments to send with this message. */
    attachmentIds: z.array(z.string()).optional(),
    /**
     * Send an approved WhatsApp template instead of free text — required to
     * re-open a conversation once its 24-hour window has closed. `params` fill
     * the template's {{1}}, {{2}} … variables in order.
     */
    template: z
      .object({ id: z.string(), params: z.array(z.string()).default([]) })
      .optional(),
    /** Quote/reply to an earlier message in the thread (by its id). */
    quotedMsgId: z.string().optional(),
    /** Reply on a specific channel the contact is reachable on (cross-channel
     *  thread). Defaults to the conversation's own channel when omitted. */
    channel: channelTypeSchema.optional(),
    /** Rich HTML body for an email reply (sanitized server-side before send). */
    bodyHtml: z.string().optional(),
    /** Additional email recipients (email channel only). */
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
  })
  // Must carry something — text, an attachment, or a template.
  .refine(
    (v) => v.body.trim().length > 0 || (v.attachmentIds?.length ?? 0) > 0 || !!v.template,
    { message: "Message needs text, an attachment, or a template", path: ["body"] },
  );
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

/** React to a message with an emoji (empty string removes the agent's reaction). */
export const reactionInputSchema = z.object({
  emoji: z.string().max(16),
});
export type ReactionInput = z.infer<typeof reactionInputSchema>;

/** Reach a customer on a channel — opens their thread there, or starts one. */
export const reachInputSchema = z.object({
  channel: z.enum(["whatsapp", "email"]),
});
export type ReachInput = z.infer<typeof reachInputSchema>;

export const assignConversationInputSchema = z.object({
  assigneeUserId: z.string().nullable().optional(),
  assignedTeamId: z.string().nullable().optional(),
});
export type AssignConversationInput = z.infer<typeof assignConversationInputSchema>;

/** Change a conversation's status — e.g. close (resolve) or reopen. */
export const updateStatusInputSchema = z.object({
  status: conversationStatusSchema,
});
export type UpdateStatusInput = z.infer<typeof updateStatusInputSchema>;

/** Set a conversation's priority. */
export const updatePriorityInputSchema = z.object({
  priority: prioritySchema,
});
export type UpdatePriorityInput = z.infer<typeof updatePriorityInputSchema>;

/** Snooze a conversation until a given time (ISO); it wakes back into the queue then. */
export const snoozeInputSchema = z.object({
  until: z.string().datetime(),
});
export type SnoozeInput = z.infer<typeof snoozeInputSchema>;

export const createInboxInputSchema = z.object({
  type: channelTypeSchema,
  name: z.string().min(1),
  handle: z.string().min(1),
  teamIds: z.array(z.string()).min(1),
  routingStrategy: routingStrategySchema.default("manual"),
  /** Provider integration credentials (phone number id, tokens, …). Backend-only. */
  channelConfig: z.record(z.string()).optional(),
});
export type CreateInboxInput = z.infer<typeof createInboxInputSchema>;

/** Edit an existing channel: rename, re-route, change strategy, or update creds. */
export const updateInboxInputSchema = z.object({
  name: z.string().min(1).optional(),
  teamIds: z.array(z.string()).min(1).optional(),
  routingStrategy: routingStrategySchema.optional(),
  channelConfig: z.record(z.string()).optional(),
});
export type UpdateInboxInput = z.infer<typeof updateInboxInputSchema>;

export const createTeamInputSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  slaMinutes: z.number().int().positive().nullable().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;

export const updateTeamInputSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  slaMinutes: z.number().int().positive().nullable().optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamInputSchema>;

/** Persist a new team ordering (array of team ids in the desired order). */
export const reorderTeamsInputSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});
export type ReorderTeamsInput = z.infer<typeof reorderTeamsInputSchema>;

export const createUserInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: roleSchema.default("agent"),
  teamIds: z.array(z.string()).default([]),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = z.object({
  name: z.string().min(1).optional(),
  role: roleSchema.optional(),
  teamIds: z.array(z.string()).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const createContactInputSchema = z.object({
  displayName: z.string().min(1),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** Pin this customer to a team so their messages always route there. */
  ownerTeamId: z.string().nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
});
export type CreateContactInput = z.infer<typeof createContactInputSchema>;

export const updateContactInputSchema = z.object({
  displayName: z.string().min(1).optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ownerTeamId: z.string().nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
});
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

/** A contact with the conversations that belong to them (Customers › detail). */
export const contactWithConversationsSchema = contactSchema.extend({
  conversations: z.array(conversationSchema),
});
export type ContactWithConversations = z.infer<typeof contactWithConversationsSchema>;

/** A user together with the teams they belong to (Settings › People). */
export const memberSchema = z.object({
  user: userSchema,
  teamIds: z.array(z.string()),
});
export type Member = z.infer<typeof memberSchema>;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const groupMemberInputSchema = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
});
export type GroupMemberInput = z.infer<typeof groupMemberInputSchema>;

export const createGroupInputSchema = z.object({
  inboxId: z.string(),
  name: z.string().min(1),
  members: z.array(groupMemberInputSchema).max(GROUP_MAX_MEMBERS),
});
export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

export const addParticipantInputSchema = groupMemberInputSchema;
export type AddParticipantInput = z.infer<typeof addParticipantInputSchema>;

/* ------------------------------------------------------------------ */
/* Integration settings (Settings › Setup)                             */
/* ------------------------------------------------------------------ */

/**
 * App-level integration settings surfaced to the client. The Google block
 * describes the org's OAuth app: the (non-secret) client id, whether it's fully
 * configured (id + secret present), and the exact redirect URI to register with
 * Google. The client secret is write-only — it is never returned.
 */
export const integrationSettingsSchema = z.object({
  google: z.object({
    clientId: z.string(),
    configured: z.boolean(),
    redirectUri: z.string(),
    /** Optional Pub/Sub topic for Gmail push; empty means polling-only. */
    pubsubTopic: z.string(),
    /** The URL to register as the Pub/Sub push subscription endpoint. */
    pushEndpoint: z.string(),
  }),
  meta: z.object({
    appId: z.string(),
    configured: z.boolean(),
    /** Optional Embedded Signup config id for the guided WhatsApp onboarding. */
    configId: z.string(),
    /** The exact URL to list as a Valid OAuth Redirect URI in the Meta app. */
    redirectUri: z.string(),
  }),
  /** Cloudflare R2 object storage for durable message media. */
  storage: z.object({
    /** True when all four R2 credentials are set (media is stored in R2). */
    configured: z.boolean(),
    /** Non-secret echo: the Cloudflare account id and bucket (keys never echoed). */
    accountId: z.string(),
    bucket: z.string(),
  }),
});
export type IntegrationSettings = z.infer<typeof integrationSettingsSchema>;

/** Update the app-level integration credentials. Secrets are written only when
 *  a non-empty value is supplied (so they can be left blank to keep the stored
 *  one); non-secret ids/config are written whenever provided, empty to clear. */
export const updateIntegrationSettingsInputSchema = z.object({
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  googlePubsubTopic: z.string().optional(),
  metaAppId: z.string().optional(),
  metaAppSecret: z.string().optional(),
  metaConfigId: z.string().optional(),
  /** Cloudflare R2: account id + bucket write on any change (empty clears);
   *  the access key id + secret are written only when a non-empty value is sent. */
  r2AccountId: z.string().optional(),
  r2AccessKeyId: z.string().optional(),
  r2SecretAccessKey: z.string().optional(),
  r2Bucket: z.string().optional(),
});
export type UpdateIntegrationSettingsInput = z.infer<typeof updateIntegrationSettingsInputSchema>;

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
  /** `who` is the sender's display name, echoed to other agents on the thread. */
  [ClientEvent.Typing]: (p: { conversationId: string; typing: boolean; who?: string }) => void;
}
