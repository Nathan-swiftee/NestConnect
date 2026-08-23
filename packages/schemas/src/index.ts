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
  /** Uploaded profile photo URL (served via /api/media/:id). Falls back to
   *  Gravatar, then coloured initials, when absent. */
  avatarUrl: z.string().nullable().optional(),
  online: z.boolean().default(false),
  /** Manual "accepting work" flag — an unavailable agent is skipped by
   *  round-robin auto-assignment (distinct from `online` presence). */
  available: z.boolean().default(true),
  /** Personal HTML email signature, appended to outbound email this user sends. */
  emailSignature: z.string().nullable().optional(),
  /** Two-factor status, surfaced so the UI can show it + gate mandatory setup.
   *  The secret itself is never sent to the client. */
  twoFactorEnabled: z.boolean().optional(),
  twoFactorMethod: z.enum(["totp", "email"]).nullable().optional(),
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
  /** Blocked customers have their inbound dropped and are hidden by default. */
  blocked: z.boolean().optional(),
});
export type Contact = z.infer<typeof contactSchema>;

/** Why two contacts were flagged as possible duplicates: a shared, canonicalised
 *  identifier (E.164 phone or lower-cased email). */
export interface ContactDuplicateReason {
  kind: "phone" | "email";
  value: string;
}
/** A cluster of contacts that probably represent the same customer, found by
 *  matching normalised phone/email. Surfaced for review, then merged. */
export interface ContactDuplicateGroup {
  contacts: Contact[];
  reasons: ContactDuplicateReason[];
}

/** Merge duplicate customers into one surviving record. The winner keeps its
 *  name; the losers' identities, conversations and blank-filled fields move
 *  onto it and the loser records are deleted. */
export const mergeContactsInputSchema = z.object({
  winnerId: z.string(),
  loserIds: z.array(z.string()).min(1),
});
export type MergeContactsInput = z.infer<typeof mergeContactsInputSchema>;

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
  /** Non-secret channelConfig values (e.g. the Phone number ID) surfaced so the
   *  channel editor can show what's configured. Access tokens are NEVER included. */
  channelConfigPublic: z.record(z.string()).optional(),
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
 * channelConfig keys that are safe to send to the client — identifiers, not
 * credentials. Access tokens (`accessToken`, `providerToken`) and the webhook
 * `verifyToken` are deliberately absent, so a token never leaves the backend.
 */
export const PUBLIC_CHANNEL_KEYS = ["phoneNumberId", "wabaId", "displayNumber", "fromName", "provider"] as const;

/** Pick only the non-secret channelConfig keys, for display in the channel editor. */
export function publicChannelConfig(
  config?: Record<string, string> | null,
): Record<string, string> | undefined {
  if (!config) return undefined;
  const out: Record<string, string> = {};
  for (const k of PUBLIC_CHANNEL_KEYS) {
    if (config[k]) out[k] = config[k];
  }
  return Object.keys(out).length ? out : undefined;
}

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
  /** The authoring agent's user id (outbound messages + internal notes); absent
   *  for inbound/system. Lets the UI tell your own note from a teammate's. */
  authorUserId: z.string().nullable().optional(),
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
  /** Email headers this message carried (email channel only), surfaced on the
   *  bubble the way an email shows its subject + Cc. */
  email: z
    .object({
      subject: z.string().optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      /** Present on a forwarded email: the people it was forwarded on to, shown
       *  on the bubble as "Forwarded to …" (distinct from a reply's recipient). */
      forwardedTo: z.array(z.string()).optional(),
      /** Per-recipient read tracking (To/Cc). Each got their own tracked copy;
       *  `openedAt` is set once their tracking pixel is first requested. Powers
       *  the per-recipient "Seen" indicators on an outbound email. */
      recipients: z
        .array(
          z.object({
            address: z.string(),
            kind: z.enum(["to", "cc"]).default("to"),
            openedAt: z.string().nullable().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
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
  /** The assignee's display name, resolved server-side so the UI can show the
   *  real owner (e.g. "Assigned to Priya") instead of a viewer-relative "You".
   *  Null when unassigned. */
  assigneeName: z.string().nullable().default(null),
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
  /** Channel of the most recent customer-facing message — a thread can span
   *  channels, and the list badge shows this rather than the origin `channel`.
   *  Falls back to `channel` when there are no customer messages yet. */
  lastChannel: channelTypeSchema.optional(),
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
  /** The workspace's default template — the one the composer sends behind the
   *  scenes once a 24-hour window has closed. Derived from an org setting, so
   *  exactly one template carries it. */
  isDefault: z.boolean().default(false),
});
export type Template = z.infer<typeof templateSchema>;

/** Set (or clear, with null) the workspace's default WhatsApp template. */
export const setDefaultTemplateInputSchema = z.object({
  templateId: z.string().nullable(),
});
export type SetDefaultTemplateInput = z.infer<typeof setDefaultTemplateInputSchema>;

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

/* ------------------------------------------------------------------ */
/* WhatsApp management: business profile + broadcasts                   */
/* ------------------------------------------------------------------ */

/**
 * A connected WhatsApp number, as the management screens see it. Drawn from an
 * inbox's public channel config — never its secrets — so the picker can label a
 * number and tell whether it's live before a management call is made.
 */
export const whatsAppNumberSchema = z.object({
  inboxId: z.string(),
  name: z.string(),
  /** The human phone number ("+44 20 …"), when saved. */
  displayNumber: z.string().optional(),
  /** Meta's phone-number id (the API handle), when saved. */
  phoneNumberId: z.string().optional(),
  /** The WhatsApp Business Account id, when saved. */
  wabaId: z.string().optional(),
  /** Whether the number has the credentials needed to make live API calls. */
  connected: z.boolean(),
});
export type WhatsAppNumber = z.infer<typeof whatsAppNumberSchema>;

/**
 * Meta's fixed set of business categories (the `vertical` on a number's public
 * profile). Kept in Meta's own SCREAMING_CASE so the values round-trip to the
 * Graph API untouched; the UI supplies the friendly labels.
 */
export const WHATSAPP_VERTICALS = [
  "UNDEFINED",
  "OTHER",
  "AUTO",
  "BEAUTY",
  "APPAREL",
  "EDU",
  "ENTERTAIN",
  "EVENT_PLAN",
  "FINANCE",
  "GROCERY",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "NOT_A_BIZ",
] as const;
export const whatsAppVerticalSchema = z.enum(WHATSAPP_VERTICALS);
export type WhatsAppVertical = z.infer<typeof whatsAppVerticalSchema>;

/** Opening hours are kept in Nest Connect (WhatsApp's profile has no hours
 *  field); one entry per weekday, "HH:MM" 24-hour, or marked closed. */
export const OPENING_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type OpeningDay = (typeof OPENING_DAYS)[number];
export const openingHoursDaySchema = z.object({
  closed: z.boolean().default(false),
  open: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  close: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
});
export type OpeningHoursDay = z.infer<typeof openingHoursDaySchema>;
export const openingHoursSchema = z.object({
  mon: openingHoursDaySchema,
  tue: openingHoursDaySchema,
  wed: openingHoursDaySchema,
  thu: openingHoursDaySchema,
  fri: openingHoursDaySchema,
  sat: openingHoursDaySchema,
  sun: openingHoursDaySchema,
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

/**
 * A WhatsApp number's public business profile — the "about" line, description,
 * address, contact details and category a customer sees on the business card.
 * Read from / written to Meta's `whatsapp_business_profile` node. The photo is
 * read-only here (Meta requires a separate resumable upload to change it).
 */
export const whatsAppBusinessProfileSchema = z.object({
  about: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  email: z.string().optional(),
  vertical: whatsAppVerticalSchema.optional(),
  websites: z.array(z.string()).optional(),
  /** Current profile photo (from Meta's `profile_picture_url`; set via upload). */
  profilePictureUrl: z.string().optional(),
  /** Kept in Nest Connect, not sent to WhatsApp. */
  openingHours: openingHoursSchema.optional(),
});
export type WhatsAppBusinessProfile = z.infer<typeof whatsAppBusinessProfileSchema>;

/** The editable fields we send back to Meta (photo excluded — resumable upload). */
export const updateWhatsAppBusinessProfileInputSchema = z.object({
  about: z.string().max(139, "Keep the “about” line under 139 characters").optional(),
  address: z.string().max(256, "Keep the address under 256 characters").optional(),
  description: z.string().max(512, "Keep the description under 512 characters").optional(),
  email: z.string().max(128, "Keep the email under 128 characters").optional(),
  vertical: whatsAppVerticalSchema.optional(),
  websites: z.array(z.string()).max(2, "At most two websites").optional(),
  /** Stored in Nest Connect only (WhatsApp has no hours field). */
  openingHours: openingHoursSchema.optional(),
});
export type UpdateWhatsAppBusinessProfileInput = z.infer<
  typeof updateWhatsAppBusinessProfileInputSchema
>;

/** A single recipient of a broadcast — a phone number, optionally named. */
export const broadcastRecipientSchema = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
  /** Per-recipient values for the template's {{1}}, {{2}} … variables. */
  params: z.array(z.string()).optional(),
});
export type BroadcastRecipient = z.infer<typeof broadcastRecipientSchema>;

/**
 * Send an approved template to many recipients at once. WhatsApp has no true
 * one-to-many primitive, so a broadcast is a loop of individual template sends
 * (the compliant way to reach many people) — each recipient gets their own
 * 1:1 message. Capped to keep a single request bounded.
 */
export const sendBroadcastInputSchema = z.object({
  /** The WhatsApp number (inbox) the broadcast is sent from. */
  inboxId: z.string(),
  /** The approved template to send (must be APPROVED at Meta). */
  templateId: z.string(),
  /** Shared variable values, used for any recipient without their own `params`. */
  params: z.array(z.string()).optional(),
  recipients: z.array(broadcastRecipientSchema).min(1).max(500),
});
export type SendBroadcastInput = z.infer<typeof sendBroadcastInputSchema>;

/** The outcome of a broadcast run: per-recipient success/failure + totals. */
export const broadcastResultSchema = z.object({
  total: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      phone: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});
export type BroadcastResult = z.infer<typeof broadcastResultSchema>;

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
    /** Subject line for an email send (email channel only). Sets the thread's
     *  subject; a reply carries "Re:" automatically, a fresh email does not. */
    subject: z.string().max(255).optional(),
    /** Additional email recipients (email channel only). */
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    /** Forward this email on to other people (email channel only). When set, the
     *  send goes to these addresses as a fresh "Fwd:" email — a new thread, not a
     *  reply to the customer — but it's still logged in the current conversation so
     *  the timeline shows the forward (Front-style). The first address is the To;
     *  any others ride as Cc. */
    forwardTo: z.array(z.string()).optional(),
  })
  // Must carry something — text, an attachment, a template, or a forward (which
  // carries the original email it's passing on).
  .refine(
    (v) =>
      v.body.trim().length > 0 ||
      (v.attachmentIds?.length ?? 0) > 0 ||
      !!v.template ||
      (v.forwardTo?.length ?? 0) > 0,
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
  /** Which connected inbox to start from — needed when several of the same
   *  channel are connected. Falls back to the first of that channel when absent. */
  inboxId: z.string().optional(),
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

/** A hex colour (#RGB or #RRGGBB) for a label swatch. */
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex colour like #0FA47A");
export const createLabelInputSchema = z.object({
  name: z.string().min(1).max(40),
  color: hexColor,
});
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;

export const updateLabelInputSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  color: hexColor.optional(),
});
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>;

/** Replace a conversation's labels with this exact set of label ids. */
export const setConversationLabelsInputSchema = z.object({
  labelIds: z.array(z.string()),
});
export type SetConversationLabelsInput = z.infer<typeof setConversationLabelsInputSchema>;

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

/** A user editing their OWN personal settings (no admin rights needed). */
export const updateMyPreferencesInputSchema = z.object({
  available: z.boolean().optional(),
  /** Rich-text (HTML) signature; empty string clears it. Images are hosted (a
   *  short https URL, not inline base64), so this only needs headroom for
   *  formatting markup and the occasional pasted data-URL. */
  emailSignature: z.string().max(200000).nullable().optional(),
});
export type UpdateMyPreferencesInput = z.infer<typeof updateMyPreferencesInputSchema>;

/** A user editing their OWN profile — name, login email, and photo. */
export const updateMyProfileInputSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  /** Uploaded photo URL (from POST /media). Empty string / null clears it. */
  avatarUrl: z.string().max(2000).nullable().optional(),
});
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileInputSchema>;

/** A user changing their OWN password — current is re-verified server-side. */
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

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
  blocked: z.boolean().optional(),
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
  /** Native clients ask for the session as a bearer token instead of a cookie:
   *  a phone has no shared cookie jar between its HTTP client, its socket and a
   *  background push registration. Browsers omit this and keep the httpOnly
   *  cookie, which is a real defence there and doesn't change. */
  tokenAuth: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/** What a tokenAuth login returns once the session is real. `token` is absent
 *  for cookie clients. */
export interface SessionGrant {
  token?: string;
  /** Seconds until the token expires, so a client can refresh ahead of it. */
  expiresIn?: number;
}

/** A signed-in device/browser shown in "Where you're signed in" (personal
 *  settings). `current` marks the session making the request. */
export interface SessionInfo {
  id: string;
  current: boolean;
  ip?: string | null;
  browser?: string | null;
  os?: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/* ---- Push devices ---- */

/** Register this install for push. Sent after sign-in and on every app start,
 *  because push tokens rotate — re-registering the same token is a no-op that
 *  just refreshes `lastSeenAt`. */
export const registerDeviceInputSchema = z.object({
  /** The Expo push token: "ExponentPushToken[…]". */
  pushToken: z.string().min(10).max(256),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(32).optional(),
  osVersion: z.string().max(32).optional(),
  /** What the person would call this phone ("Nathan's iPhone"), for the
   *  signed-in-devices list. */
  deviceName: z.string().max(120).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceInputSchema>;

/** A registered device, as its owner sees it. The push token never leaves the
 *  server — it's an address someone else could send to. */
export interface DeviceInfo {
  id: string;
  platform: string;
  deviceName?: string | null;
  appVersion?: string | null;
  osVersion?: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** Set when we've stopped pushing here — a dead token, or permission revoked. */
  disabledReason?: string | null;
}

/** "HH:MM", 24-hour. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/**
 * What a person wants pushed to their phone.
 *
 * The defaults are the point of this shape: everything about *me* is on, and
 * all-team-inbound is off. A busy shared inbox that pushes every arrival is the
 * setting that makes people turn notifications off entirely — at which point
 * they miss the ones that mattered.
 */
export const pushPreferencesSchema = z.object({
  /** A new message in a conversation assigned to me. */
  assigned: z.boolean().default(true),
  /** An @mention of me in an internal note. */
  mentions: z.boolean().default(true),
  /** Someone assigned a conversation to me. */
  assignments: z.boolean().default(true),
  /** A conversation I snoozed has come due. */
  reminders: z.boolean().default(true),
  /** Any new inbound in an inbox my team owns. Off by default, deliberately. */
  teamInbound: z.boolean().default(false),
  /** Silence non-urgent pushes between these times. `end` before `start` means
   *  the window crosses midnight (22:00 → 07:00), which is the usual case. */
  quietHours: z.object({ start: timeOfDay, end: timeOfDay }).nullable().default(null),
  /** IANA zone the quiet hours are read in; the workspace's default when unset. */
  timezone: z.string().max(64).optional(),
});
export type PushPreferences = z.infer<typeof pushPreferencesSchema>;

/** Every field optional — the client sends only what changed. */
export const updatePushPreferencesInputSchema = pushPreferencesSchema.partial();
export type UpdatePushPreferencesInput = z.infer<typeof updatePushPreferencesInputSchema>;

/** The defaults, as a value. Parsing `{}` applies every `.default()` above, so
 *  this can't drift from the schema. */
export const DEFAULT_PUSH_PREFERENCES: PushPreferences = pushPreferencesSchema.parse({});

/** Set an initial password from an emailed invite link (token → new password). */
export const setPasswordInputSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Use at least 8 characters"),
});
export type SetPasswordInput = z.infer<typeof setPasswordInputSchema>;

/* ---- Two-factor auth ---- */

/** A 6-digit authenticator/email code — or a one-time recovery code. */
export const twoFactorCodeInputSchema = z.object({
  code: z.string().trim().min(4).max(32),
  /** The half-authenticated token from a tokenAuth login, when there's no
   *  cookie to carry it. */
  pendingToken: z.string().optional(),
  tokenAuth: z.boolean().optional(),
});
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeInputSchema>;

/** Starting authenticator setup: the secret to store + a QR to scan. */
export interface TotpSetup {
  /** Base32 secret, shown for manual entry when a QR can't be scanned. */
  secret: string;
  /** otpauth://… URI encoded in the QR. */
  otpauthUrl: string;
  /** data:image/png;base64,… QR image of `otpauthUrl`. */
  qrDataUrl: string;
}

/** Returned once when 2FA is switched on — the recovery codes to save. */
export interface TwoFactorEnabled {
  recoveryCodes: string[];
}

/** Current 2FA status for the settings panel. */
export interface TwoFactorStatus {
  enabled: boolean;
  method: "totp" | "email" | null;
  recoveryCodesRemaining: number;
}

/** Login when the account has 2FA on: the password step returns this instead of
 *  a session, and the client then posts the code to /auth/login/2fa. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  method: "totp" | "email";
}

export const groupMemberInputSchema = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
});
export type GroupMemberInput = z.infer<typeof groupMemberInputSchema>;

export const createGroupInputSchema = z.object({
  inboxId: z.string(),
  name: z.string().min(1),
  // Optional/ignored for the real Groups API: a group is invite-only, so members
  // join via the shared invite link (there is no add-by-phone endpoint). Kept for
  // backward-compatibility with callers that still pass a roster.
  members: z.array(groupMemberInputSchema).max(GROUP_MAX_MEMBERS).optional().default([]),
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
  /** SMTP (e.g. Gmail) for the app's own transactional email — invites,
   *  password resets and the test send. */
  smtp: z.object({
    /** True when host + username + password + from are all set. */
    configured: z.boolean(),
    /** Non-secret echo — the app password is never returned. */
    host: z.string(),
    port: z.number(),
    username: z.string(),
    from: z.string(),
    secure: z.boolean(),
  }),
  /** Resend (HTTPS API) for the app's own transactional email — the preferred
   *  transport when configured (works where the host blocks outbound SMTP). */
  resend: z.object({
    /** True when an API key is set. */
    configured: z.boolean(),
    /** Non-secret echo — the from-address (the API key is never returned). */
    from: z.string(),
  }),
  /** Claude (Anthropic) — powers the composer's one-tap Polish. */
  anthropic: z.object({
    /** True when an API key is set. */
    configured: z.boolean(),
    /** Non-secret echo — the model id (the API key is never returned). */
    model: z.string(),
    /** The system prompt Polish runs. Editable; seeded with the default below. */
    polishPrompt: z.string(),
  }),
});
export type IntegrationSettings = z.infer<typeof integrationSettingsSchema>;

/** The default Polish instruction, shown pre-filled in Settings so it can be
 *  tuned per workspace. The constraints are the feature: Polish rewrites HOW
 *  something is said, never WHAT is said. It must not answer the customer,
 *  invent facts (dates, prices, promises), or drop anything the agent wrote. */
export const DEFAULT_POLISH_PROMPT = `You improve a Swiftee support agent's draft reply before they send it.

You are given the recent conversation for context, then the agent's draft. Rewrite the draft into a message that is ready to send.

Do this:
- Elaborate. A draft is usually shorthand — turn it into a proper reply: full sentences, the natural connecting words, and phrasing that reads as an answer to what the customer actually asked.
- Use the conversation only to understand the situation — who they are, what they asked, what has already been said — so the reply lands in context and doesn't repeat what's been covered.
- Write in Swiftee's voice: professional and competent, but warm and human. British English. Direct and specific. Contractions are fine. No corporate filler ("we appreciate your patience at this time"), no grovelling, no exclamation-mark enthusiasm.

Never do this:
- Never invent facts. No prices, dates, times, order numbers, names, links, policies, refunds, discounts or promises that aren't in the agent's draft or in the conversation. If the draft doesn't say when something will arrive, neither does your reply.
- Never answer for the agent. If the draft leaves something the customer asked unaddressed, leave it unaddressed — elaborating a draft is not continuing the conversation.
- Never change the meaning or the level of commitment: a "no" stays a no, a "maybe" stays a maybe, "I'll check" stays "I'll check".
- Never drop anything the agent wrote.
- Leave URLs, order numbers, reference codes, @mentions and emoji exactly as written.
- Don't add a greeting or sign-off the agent didn't write, unless the channel plainly calls for one.

Reply with the finished message only — no preamble, no explanation, no quotes around it.`;

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
  /** SMTP transactional email. Host/port/username/from/secure write on any change
   *  (empty clears); the app password is written only when a non-empty value is
   *  sent, so it can be left blank to keep the stored one. */
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpUsername: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFrom: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  /** Resend transactional email. `resendFrom` writes on any change (empty clears);
   *  the API key is written only when a non-empty value is sent, so it can be left
   *  blank to keep the stored one. */
  resendApiKey: z.string().optional(),
  resendFrom: z.string().optional(),
  /** Claude (Anthropic). The model and prompt write on any change (empty resets
   *  to the default); the API key is written only when a non-empty value is
   *  sent, so it can be left blank to keep the stored one. */
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().optional(),
  anthropicPolishPrompt: z.string().optional(),
});
export type UpdateIntegrationSettingsInput = z.infer<typeof updateIntegrationSettingsInputSchema>;

/* ------------------------------------------------------------------ */
/* AI assist — one-tap Polish on a draft reply.                        */
/* ------------------------------------------------------------------ */

/** Polish a draft. `channel` only tunes register (a WhatsApp line is shorter
 *  and less formal than an email); it never changes what the draft says. */
export const polishDraftInputSchema = z.object({
  text: z.string().min(1).max(5000),
  channel: channelTypeSchema.optional(),
  /** Internal notes are polished for teammates, not customers. */
  internal: z.boolean().optional(),
  /** The thread being replied to. The server loads the recent messages itself
   *  (the client never sends history) so the model can see what's actually
   *  being discussed and the reply lands in context. */
  conversationId: z.string().optional(),
});
export type PolishDraftInput = z.infer<typeof polishDraftInputSchema>;

export const polishDraftResultSchema = z.object({
  /** The polished draft. Equal to the input when the model left it alone. */
  text: z.string(),
  /** True when the model returned something different from the draft. */
  changed: z.boolean(),
});
export type PolishDraftResult = z.infer<typeof polishDraftResultSchema>;

/** A "forgot my password" request — emails a reset link if the address matches. */
export const forgotPasswordInputSchema = z.object({ email: z.string().email() });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

/* ------------------------------------------------------------------ */
/* Notifications (the bell) — a per-user history of noteworthy events.  */
/* High-frequency events (a new inbound chat) stay sound-only and never */
/* land here.                                                           */
/* ------------------------------------------------------------------ */
export const notificationTypeSchema = z.enum(["mention", "snooze_due"]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  /** Short headline (e.g. "James mentioned you"). */
  title: z.string(),
  /** Optional detail line (e.g. the note snippet or the customer name). */
  body: z.string().default(""),
  /** The conversation to open when the notification is tapped. */
  conversationId: z.string().nullable().optional(),
  read: z.boolean().default(false),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

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
  Notification: "notification",
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
  [ServerEvent.Notification]: (p: { notification: Notification }) => void;
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

/* ------------------------------------------------------------------ */
/* Analytics (admin/manager insights dashboard)                        */
/* ------------------------------------------------------------------ */

/** The named time windows the dashboard offers (plus a resolved from/to). */
export const analyticsRangeSchema = z.enum(["7d", "30d", "90d", "12m"]);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

/** Query params for GET /api/analytics. `channel`/`teamId`/`agentUserId` accept
 *  "all" (or omission) to mean no filter. */
export const analyticsQuerySchema = z.object({
  range: analyticsRangeSchema.default("30d"),
  channel: z.union([channelTypeSchema, z.literal("all")]).default("all"),
  teamId: z.string().default("all"),
  agentUserId: z.string().default("all"),
});
export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;

/** One point on the daily volume series. */
export interface AnalyticsDailyPoint {
  date: string; // YYYY-MM-DD
  conversations: number;
  inbound: number;
  outbound: number;
}

/** The fully-computed dashboard payload returned by the analytics endpoint. */
export interface AnalyticsResult {
  range: { key: AnalyticsRange; from: string; to: string; days: number };
  filters: { channel: ChannelType | "all"; teamId: string | "all"; agentUserId: string | "all" };
  /** Headline numbers for the KPI cards, each with its previous-period value so
   *  the UI can show a delta. `firstResponse`/`resolution` are in milliseconds. */
  kpis: {
    conversations: number;
    messages: number;
    inbound: number;
    outbound: number;
    newContacts: number;
    activeAgents: number;
    avgFirstResponseMs: number | null;
    medianFirstResponseMs: number | null;
    resolved: number;
    resolutionRate: number; // 0..1
    responseRate: number; // 0..1 — share of conversations that got an agent reply
    avgMessagesPerConversation: number;
    /** Same metrics over the immediately preceding equal-length window. */
    prev: {
      conversations: number;
      messages: number;
      newContacts: number;
      avgFirstResponseMs: number | null;
    };
  };
  /** "Right now" status counts across the (filtered) conversation set. */
  snapshot: { open: number; pending: number; snoozed: number; closed: number; unassigned: number; total: number };
  daily: AnalyticsDailyPoint[];
  byChannel: Array<{ channel: ChannelType; conversations: number; messages: number }>;
  byStatus: Array<{ status: ConversationStatus; count: number }>;
  byPriority: Array<{ priority: Priority; count: number }>;
  byTeam: Array<{ teamId: string | null; name: string; conversations: number }>;
  byLabel: Array<{ labelId: string; name: string; color: string; conversations: number }>;
  /** Per-agent leaderboard, busiest first. */
  agents: Array<{
    userId: string;
    name: string;
    avatarColor: string | null;
    conversations: number;
    replies: number;
    avgFirstResponseMs: number | null;
  }>;
  /** Message volume by weekday × hour: 168 counts, index = weekday*24 + hour,
   *  weekday 0 = Monday. Drives the activity heatmap. */
  heatmap: number[];
  /** First-response-time distribution across labelled buckets. */
  responseBuckets: Array<{ label: string; count: number }>;
}
