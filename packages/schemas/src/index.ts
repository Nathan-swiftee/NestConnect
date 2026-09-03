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
  NestChat: "nestchat",
} as const;
export const channelTypeSchema = z.enum(["whatsapp", "whatsapp_group", "email", "nestchat"]);
export type ChannelType = z.infer<typeof channelTypeSchema>;

/**
 * How we know a customer. One person can have several: a phone number, an email
 * address, a WhatsApp id, a browser that has chatted with us before. Matching on
 * any of them is what makes a conversation follow the person across channels.
 *
 * `nestchat` is the odd one out — it is a random id the visitor's own browser
 * keeps, not something they own or could prove. It identifies a *browser*, so it
 * unifies a returning visitor with their own history and nothing else.
 */
export const contactIdentityKindSchema = z.enum(["phone", "email", "wa_id", "nestchat"]);
export type ContactIdentityKind = z.infer<typeof contactIdentityKindSchema>;

/**
 * How often an agent's client should re-poke the CUSTOMER-facing typing
 * indicator on this channel, or null where the customer is shown nothing.
 *
 * Separate from the presence agents broadcast to each other, and channel-shaped
 * because the two that have it keep it alive for very different lengths of
 * time: WhatsApp holds an indicator ~25 seconds per ping, so pinging hard would
 * be rude to Meta and pointless; the NestChat widget drops its dots after a few
 * seconds, so the same interval would make them blink on and off while somebody
 * is mid-sentence.
 *
 * Here rather than in each client because it was in neither: both the web and
 * the phone gated this on "is this WhatsApp", so NestChat visitors saw nothing
 * however well the server behaved.
 */
export function typingPingMs(channel: ChannelType): number | null {
  switch (channel) {
    case "whatsapp":
    case "whatsapp_group":
      return 9_000;
    case "nestchat":
      return 3_000;
    default:
      return null;
  }
}

/**
 * The channels the composer offers on an open thread.
 *
 * A thread's channel is its identity, but the composer may answer on any channel
 * the customer is actually reachable on — someone who wrote in by email and gave
 * us a phone number can be answered on WhatsApp without starting a second
 * conversation. A group is the exception: a group message goes to the group, so
 * that is the only place to answer it.
 *
 * The thread's own channel is always in the list. Deriving this purely from the
 * addresses on the contact record dropped it whenever the thread was on a
 * channel that isn't a phone or an email — a NestChat thread with a customer
 * whose email we hold offered WhatsApp and Email and no way to reply in the chat
 * the visitor was sitting in. It hid for as long as visitors stayed anonymous,
 * because an empty list fell through to the thread's own channel; it appeared
 * the moment they started telling us who they were.
 *
 * Here rather than in each client because both clients had written it out, and
 * both were wrong in the same way. One list, one place to be right.
 */
export function replyTargetsFor(conv: {
  channel: ChannelType;
  contact: { phone?: string | null; email?: string | null };
}): ChannelType[] {
  if (conv.channel === "whatsapp_group") return [conv.channel];
  const out: ChannelType[] = [];
  if (conv.contact.phone) out.push("whatsapp");
  if (conv.contact.email) out.push("email");
  if (!out.includes(conv.channel)) out.push(conv.channel);
  return out;
}

export const conversationStatusSchema = z.enum(["open", "pending", "snoozed", "closed"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

/**
 * The statuses an inbound message may thread into.
 *
 * A customer writing again continues the conversation they are already in —
 * including one an agent has put down for later. Snoozing says "not now", not
 * "not this person"; if they come back before the timer does, the timer is what
 * loses. The store that receives the message wakes it (see `appendInboundMessage`
 * in either store), so the only job here is to make sure the lookup *finds* it.
 *
 * `closed` is deliberately absent. A resolved conversation is finished, and a
 * new subject from the same customer deserves its own thread rather than being
 * filed under whatever was last settled with them. Email is the exception and
 * makes itself one: a reply carrying a `References` chain is matched by that
 * chain instead, which has no status filter at all, so it reopens the exact
 * thread it belongs to.
 *
 * Shared because it was written twice — once in each store — and the copies
 * disagreed. Both had "open" and "pending" and neither had "snoozed", so every
 * reply to a snoozed chat opened a *second* conversation with the same customer
 * and the wake-it-up branch waiting in both stores could never run.
 */
export const THREADABLE_STATUSES = ["open", "pending", "snoozed"] as const satisfies readonly ConversationStatus[];

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
  /** The browser id this customer first chatted from, if they came in through a
   *  NestChat widget. Its own field rather than folded into `phone`: it is not a
   *  number, nothing can be dialled or messaged at it, and showing it under a
   *  phone icon tells an agent something untrue. */
  visitorId: z.string().optional(),
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
  // NestChat is our own channel — there is no third party to authenticate with,
  // so a NestChat inbox is live the moment it exists (its widget key is minted
  // on creation). An empty requirement list makes isInboxConnected() say so.
  nestchat: [],
};

/**
 * channelConfig keys that are safe to send to the client — identifiers, not
 * credentials. Access tokens (`accessToken`, `providerToken`) and the webhook
 * `verifyToken` are deliberately absent, so a token never leaves the backend.
 */
export const PUBLIC_CHANNEL_KEYS = [
  "phoneNumberId",
  "wabaId",
  "displayNumber",
  "fromName",
  "provider",
  // The NestChat widget key is public by design — it is what the embed snippet
  // on the customer's own website carries. It identifies an inbox; it authorises
  // nothing beyond "open a chat with this business", which is the point.
  "widgetKey",
] as const;

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
  /** This message is a forward — it was passed on from somewhere else rather than
   *  written here. Set on our own sends when an agent forwards, and on inbound
   *  when WhatsApp tells us the customer forwarded it to us. Rendered as the
   *  "Forwarded" label WhatsApp users already read as "this isn't their words". */
  forwarded: z.boolean().optional(),
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

/** WhatsApp's own limit on how many chats one message can be forwarded to at
 *  once. Mirrored here so an agent isn't offered a bulk-send WhatsApp would
 *  read as spam — the number is theirs, and the reason for it is theirs too. */
export const FORWARD_MAX_TARGETS = 5;

/** Pass a message on to other customers' WhatsApp chats. Targets are customers,
 *  not addresses: a WhatsApp forward lands in a chat, and the thread it lands in
 *  is opened (or reused) as part of the send. */
export const forwardMessageInputSchema = z.object({
  contactIds: z.array(z.string()).min(1).max(FORWARD_MAX_TARGETS),
});
export type ForwardMessageInput = z.infer<typeof forwardMessageInputSchema>;

/** What happened for one forward target. Reported per target rather than as a
 *  single pass/fail, because the common failure — a closed 24-hour window — is
 *  per chat, and an agent needs to know *which* ones didn't go. */
export interface ForwardResult {
  contactId: string;
  /** Display name, so the caller can report the outcome without a second lookup. */
  name: string;
  ok: boolean;
  /** The thread it landed in (present on success) — lets the UI offer to open it. */
  conversationId?: string;
  /** Why it didn't go, in words an agent can act on. */
  error?: string;
}

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

/** A hex colour (#RGB or #RRGGBB) — a label swatch, a widget's brand colour. */
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex colour like #0FA47A");

/* ------------------------------------------------------------------ */
/* NestChat — our own live chat channel                                */
/* ------------------------------------------------------------------ */

/**
 * How a NestChat widget looks and what it says. Every string a visitor can read
 * is here rather than in the widget's source, because the business — not us —
 * decides how it greets its own customers.
 *
 * Colours are stored as authored (a `#rrggbb`, validated below) and applied as
 * CSS custom properties, so the widget never interpolates untrusted text into a
 * style rule.
 */
export const nestchatAppearanceSchema = z.object({
  /** Brand colour: the header, the launcher, and the visitor's own bubbles. */
  accent: hexColor.default("#2563eb"),
  /** Text drawn on top of `accent` — authored, because a light brand colour
   *  needs dark text and we can't guess which without a contrast calculation
   *  the business may disagree with. */
  accentText: hexColor.default("#ffffff"),
  /**
   * Run the header as a gradient from `accent` to `accentTo`.
   *
   * Off by default, and only the header: the launcher, the send button and the
   * visitor's own bubbles stay flat. A gradient is a surface — it wants room to
   * travel and reads as depth across a header-sized block. On a 26px button it
   * is two colours fighting in a space too small to tell them apart.
   */
  headerGradient: z.boolean().default(false),
  /** The far end of that gradient. Ignored while `headerGradient` is off, so it
   *  keeps a sensible value to switch on rather than turning the header black. */
  accentTo: hexColor.default("#7c3aed"),
  /** "auto" follows the visitor's own OS preference. */
  theme: z.enum(["light", "dark", "auto"]).default("light"),
  /**
   * The quiet line above the title — "Hello Marta." to the title's "How can we
   * help?".
   *
   * Two lines rather than one because they do different jobs: this one is a
   * greeting and takes the visitor's name, the title is the question. Dimmed,
   * so the eye lands on the question. Blank drops the line entirely.
   */
  headline: z.string().max(60).default("Hello {name} 👋"),
  title: z.string().max(60).default("How can we help?"),
  subtitle: z.string().max(120).default("We usually reply in a few minutes"),
  /** The first thing in the empty thread — shown before the visitor writes. */
  greeting: z.string().max(300).default("Hi 👋 How can we help today?"),
  placeholder: z.string().max(60).default("Write a message…"),
  /** The floating bubble's tooltip, for the script embed. */
  launcherLabel: z.string().max(40).default("Chat with us"),
  /** Shown in place of the subtitle when no agent is online. */
  awayMessage: z
    .string()
    .max(200)
    .default("We're away right now — leave a message and we'll reply by email."),
  /**
   * Said to the visitor when an agent closes the chat.
   *
   * Written by the business because closing means different things to
   * different ones — a resolved ticket, an ended shift, a booking confirmed —
   * and the sentence that fits is theirs. Blank says nothing and still ends the
   * session: some businesses would rather the chat simply stop than announce
   * that it has.
   */
  closedMessage: z
    .string()
    .max(300)
    .default("This chat has been closed. Thanks for getting in touch!"),
  /** The way back in, once a chat has been closed. */
  newChatLabel: z.string().max(40).default("Start a new chat"),
  /** Ask for an email before the first message, so a reply can reach someone
   *  who has closed the tab. */
  askEmail: z.boolean().default(true),
  askEmailLabel: z.string().max(80).default("Your email, so we can reply if you leave"),
  /** Ask for a phone number as well. Off by default — one field converts better
   *  than two, and most businesses only need one way back to the person. */
  askPhone: z.boolean().default(false),
  askPhoneLabel: z.string().max(80).default("Phone (optional)"),
  /** Show the faces of the team that answers this channel, the way a shop shows
   *  you who is behind the counter. */
  showTeam: z.boolean().default(true),
  showBranding: z.boolean().default(true),
  /**
   * The business's own logo, in the top-left of the header.
   *
   * A URL rather than an upload: every business embedding this already hosts a
   * logo on the site the widget is going on, and asking them to upload a second
   * copy is asking them to keep two in sync. Blank shows no logo, which is the
   * default — a widget with a broken image in the corner is worse than one
   * without a logo.
   *
   * https only. The widget is an iframe that can be embedded on a secure page,
   * and an http image there is blocked as mixed content — so it would simply
   * not appear, which is the most confusing possible outcome for a setting you
   * can see is filled in.
   */
  logoUrl: z
    .string()
    .max(500)
    .default("")
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "Must be an https:// address"),
  /**
   * A logo uploaded here rather than linked, which is what the settings pane
   * offers — most businesses would rather drop a file in than find a URL.
   *
   * The id of a stored attachment, not a URL. The bytes are served by the
   * channel's own public logo route, so the address is derived from the widget
   * key at read time: a logo whose URL was baked in at upload time would break
   * the day a key was rotated. Wins over `logoUrl` when both are set.
   */
  logoAttachmentId: z.string().max(64).default(""),
  /** Which corner the script embed's launcher sits in. */
  position: z.enum(["right", "left"]).default("right"),
});
export type NestChatAppearance = z.infer<typeof nestchatAppearanceSchema>;

/** The appearance every new NestChat channel starts with. */
export const DEFAULT_NESTCHAT_APPEARANCE: NestChatAppearance = nestchatAppearanceSchema.parse({});

/* ---- who we're talking to, and who should answer ---- */

/**
 * One field on the pre-chat form.
 *
 * Two booleans rather than one tri-state, because "we ask but you may skip" is
 * a real and common choice: an optional email converts better than a required
 * one, and a business that wants the address more than the conversation can say
 * so. `required` is meaningless while `enabled` is false, and the widget reads
 * it that way.
 */
export const nestchatFieldSchema = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
});
export type NestChatField = z.infer<typeof nestchatFieldSchema>;

/**
 * What we ask before the conversation starts.
 *
 * Off by default: this is a gate in front of a chat widget, and adding one to
 * every existing channel because we shipped the feature would quietly cost
 * businesses conversations they were having yesterday.
 *
 * Asking *before* the first message rather than after it is the whole point.
 * The details are what let us find the customer we already know, and finding
 * them before the conversation exists means it is created against their record
 * — with their history, their owner and their name in the agent's queue —
 * rather than against `Visitor 4f2a1c` and merged afterwards.
 */
export const nestchatPreChatSchema = z.object({
  enabled: z.boolean().default(false),
  intro: z
    .string()
    .max(200)
    .default("Tell us who you are and we’ll get you to the right person."),
  nameLabel: z.string().max(60).default("Your name"),
  emailLabel: z.string().max(60).default("Email"),
  phoneLabel: z.string().max(60).default("Phone"),
  submitLabel: z.string().max(40).default("Start chat"),
  /** A way out when nothing on the form is required — so a visitor with a quick
   *  question isn't made to fill in a form to ask it. */
  skipLabel: z.string().max(40).default("Skip"),
  name: nestchatFieldSchema.default({ enabled: true, required: true }),
  email: nestchatFieldSchema.default({ enabled: true, required: true }),
  phone: nestchatFieldSchema.default({ enabled: false, required: false }),
});
export type NestChatPreChat = z.infer<typeof nestchatPreChatSchema>;
export const DEFAULT_NESTCHAT_PRECHAT: NestChatPreChat = nestchatPreChatSchema.parse({});

/* ---- the home screen ---- */

/**
 * The marks a home card can carry.
 *
 * Deliberately short. Every one of these is a channel a business actually
 * staffs; a picker with forty icons in it is a picker somebody has to shop in.
 */
export const NESTCHAT_CARD_ICONS = [
  "chat",
  "whatsapp",
  "email",
  "phone",
  "instagram",
  "facebook",
  "telegram",
  "link",
] as const;
export type NestChatCardIcon = (typeof NESTCHAT_CARD_ICONS)[number];

/**
 * One card on the widget's home screen — a way to reach the business that
 * isn't this chat.
 *
 * Plenty of businesses answer faster on WhatsApp than on a website widget, and
 * a visitor who would rather email should not have to hunt the footer for the
 * address. Offering those next to the chat costs a row and stops the widget
 * pretending it is the only door.
 */
export const nestchatHomeCardSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  /** The quiet second line — "Usually answers within the hour". */
  sublabel: z.string().max(80).default(""),
  /**
   * Which mark to draw, from a fixed set.
   *
   * A key rather than an emoji, unlike the routing pills. An emoji is drawn by
   * the visitor's own operating system: 💬 is a different object on Windows,
   * Android and a Mac, and the row of them ends up in four styles at four
   * weights. These are drawn by us, so a WhatsApp card carries the WhatsApp
   * glyph everywhere and the set looks like one set.
   *
   * `.catch` rather than a bare enum: an unrecognised value degrades to no
   * icon, instead of failing the whole blob and taking the entire home screen
   * down with it.
   */
  icon: z.enum(NESTCHAT_CARD_ICONS).optional().catch(undefined),
  /**
   * Where it goes.
   *
   * Deliberately a three-scheme allowlist rather than a URL check. This string
   * is set by an admin and rendered as an `href` inside an iframe on a
   * customer's own website: `javascript:` there is script execution on our
   * origin, and `data:` is a page we would be hosting. Neither is a link, and
   * neither has any business in a "reach us on another channel" card.
   */
  href: z
    .string()
    .min(1)
    .max(500)
    .refine(
      (v) => /^(https:\/\/|mailto:|tel:)/i.test(v),
      "Must start with https://, mailto: or tel:",
    ),
});
export type NestChatHomeCard = z.infer<typeof nestchatHomeCardSchema>;

/** Enough for the channels a business actually staffs. */
export const NESTCHAT_MAX_HOME_CARDS = 6;

/**
 * The screen a visitor lands on before the conversation.
 *
 * Off by default, and that is a considered default rather than caution: it puts
 * a tap between somebody and the message box. A business that answers on one
 * channel doesn't need it; one that answers on four does.
 *
 * The chat card is not in `cards` because it is not a link — it is the widget's
 * own front door, always first and never removable. Its words are configurable;
 * its existence isn't.
 */
export const nestchatHomeSchema = z.object({
  enabled: z.boolean().default(false),
  chatLabel: z.string().max(60).default("Send us a message"),
  chatSublabel: z.string().max(80).default("We usually reply in a few minutes"),
  cards: z.array(nestchatHomeCardSchema).max(NESTCHAT_MAX_HOME_CARDS).default([]),
});
export type NestChatHome = z.infer<typeof nestchatHomeSchema>;
export const DEFAULT_NESTCHAT_HOME: NestChatHome = nestchatHomeSchema.parse({});

/* ---- the header's fill ---- */

/** A validated `#rgb`/`#rrggbb` as its three channels. */
function rgbOf(hex: string): [number, number, number] | undefined {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return undefined;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hexOf = (c: number[]): string => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** One of the business's colours at partial strength — a pool of light without
 *  a second setting to author. */
function withAlpha(hex: string, alpha: number): string {
  const c = rgbOf(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : hex;
}

/** Toward black (negative) or white (positive), for depth in the header. */
function shade(hex: string, amount: number): string {
  const c = rgbOf(hex);
  if (!c) return hex;
  const to = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return hexOf(c.map((v) => Math.round(v + (to - v) * t)));
}

/** Between two of the business's colours, for the gradient's middle stop. */
function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return a;
  return hexOf(x.map((v, i) => Math.round(v + (y[i] - v) * t)));
}

/**
 * The CSS `background` for a widget header.
 *
 * Shared rather than written twice because the settings preview has to agree
 * with the widget about what the gradient toggle actually produces, and "close
 * enough" in a preview is a preview nobody trusts.
 *
 * A gradient here is three layers, not one ramp. A single
 * `linear-gradient(135deg, a, b)` moves along exactly one axis and reads as
 * flat colour that happens to change; two off-axis pools of light over a
 * three-stop diagonal give it somewhere to come from and somewhere to go. Both
 * pools are derived from the two colours the business already chose — nobody is
 * being asked to author a mesh.
 */
export function nestchatHeaderRing(a: {
  accent: string;
  accentText: string;
  headerGradient: boolean;
}): string {
  // A flat header can ring the presence dot in its own colour, which cuts the
  // dot out of the surface. A gradient has no single colour to cut out of, so
  // it takes a soft outline in the header's own text colour instead — right at
  // both ends of the ramp.
  return a.headerGradient ? withAlpha(a.accentText, 0.4) : a.accent;
}

export function nestchatHeaderBackground(a: {
  accent: string;
  accentTo: string;
  headerGradient: boolean;
}): string {
  if (!a.headerGradient) return a.accent;
  return [
    `radial-gradient(90% 80% at 82% 8%, ${withAlpha(a.accentTo, 0.95)} 0%, transparent 62%)`,
    // The depth anchor, and the reason it is at 58% rather than in the bottom
    // corner where it started: the home screen dissolves the last 74px of this
    // header into the panel, and a dark blob sitting inside that ramp gives the
    // fade something to travel across. Contrast is what makes a dissolve
    // visible. Lifted clear of it, the bottom of the header is an even, light
    // field and the fade has almost nothing left to give away — which is how
    // the gradients this is modelled on finish.
    `radial-gradient(80% 78% at 2% 58%, ${withAlpha(shade(a.accent, -0.42), 0.92)} 0%, transparent 62%)`,
    `linear-gradient(152deg, ${a.accent} 0%, ${mix(a.accent, a.accentTo, 0.5)} 52%, ${a.accentTo} 100%)`,
  ].join(", ");
}

/**
 * One thing a visitor can say they are here about, and the team that answers it.
 *
 * This is the widget's version of "press 1 for sales" — except that unlike a
 * phone menu it costs the visitor one tap and tells us something we would
 * otherwise have to read a paragraph to learn.
 */
export const nestchatRoutingOptionSchema = z.object({
  /**
   * Minted when the option is created and never reused.
   *
   * Its own id rather than the label, because the label is what a visitor's
   * signed token would then carry — and renaming "Sales" to "New business"
   * would strand everyone who picked it and hadn't written yet.
   */
  id: z.string().min(1).max(40),
  /**
   * What the visitor reads on the pill, and all they read.
   *
   * There is no second line by design. A pill is as wide as its own label and
   * wraps with its neighbours, which is what keeps a menu of eight to two or
   * three rows; a description would put a second line inside every one of them
   * and undo exactly that. If a label needs explaining, it is the label that
   * wants rewording.
   */
  label: z.string().min(1).max(60),
  /** An emoji for the pill. Deliberately not an icon key: this is drawn on
   *  somebody else's website, where our icon set doesn't exist. */
  icon: z.string().max(8).optional(),
  /**
   * The team that answers it.
   *
   * Constrained to the channel's own teams (`inbox.teamIds`), checked where it
   * is saved rather than here — the schema can't see the channel. That
   * constraint is not bureaucracy: the widget's header shows the faces of the
   * teams a channel routes to, so an option pointing somewhere else would
   * promise a visitor one team and hand them to another.
   */
  teamId: z.string().min(1),
});
export type NestChatRoutingOption = z.infer<typeof nestchatRoutingOptionSchema>;

/** Enough for a real menu, few enough to stay a row of chips rather than a form
 *  the visitor has to read. */
export const NESTCHAT_MAX_ROUTING_OPTIONS = 8;

export const nestchatRoutingSchema = z.object({
  enabled: z.boolean().default(false),
  prompt: z.string().max(120).default("What can we help with?"),
  /** Whether a choice is needed before they can start. Optional is a real
   *  configuration: a menu can be a shortcut rather than a toll gate. */
  required: z.boolean().default(true),
  options: z
    .array(nestchatRoutingOptionSchema)
    .max(NESTCHAT_MAX_ROUTING_OPTIONS)
    .default([]),
});
export type NestChatRouting = z.infer<typeof nestchatRoutingSchema>;
export const DEFAULT_NESTCHAT_ROUTING: NestChatRouting = nestchatRoutingSchema.parse({});

/**
 * A routing option as a *visitor* may see it.
 *
 * The team id is absent, and that is the entire reason this type exists. The
 * widget runs on somebody else's website behind a public key; which internal
 * team answers "Billing" is org structure, and a visitor picking an option
 * doesn't need it to pick one.
 */
export const nestchatPublicOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
});
export type NestChatPublicOption = z.infer<typeof nestchatPublicOptionSchema>;

export const nestchatPublicRoutingSchema = z.object({
  prompt: z.string(),
  required: z.boolean(),
  options: z.array(nestchatPublicOptionSchema),
});
export type NestChatPublicRouting = z.infer<typeof nestchatPublicRoutingSchema>;

/**
 * Project a channel's routing menu down to what a visitor may see.
 *
 * Built field by field on purpose, like `toVisitorMessage`: this crosses into
 * an unauthenticated stranger's browser on somebody else's website, and
 * `teamId` — which every option carries — is internal org structure that tells
 * them nothing they need in order to press a button. A field added to the
 * option type later cannot leak by default.
 *
 * Options naming a team the channel no longer routes to are dropped rather than
 * shown: picking one would silently land the visitor in the default queue,
 * having been told they'd reached somebody in particular.
 *
 * Returns undefined for a menu that is off, or that has nothing left in it, so
 * the widget's question stays "is there a menu?" rather than "is there a menu
 * with anything in it?".
 */
export function toPublicRouting(
  routing: NestChatRouting,
  teamIds: string[],
): NestChatPublicRouting | undefined {
  if (!routing.enabled) return undefined;
  const options = routing.options
    .filter((o) => teamIds.includes(o.teamId))
    .map((o) => ({ id: o.id, label: o.label, icon: o.icon }));
  if (!options.length) return undefined;
  return { prompt: routing.prompt, required: routing.required, options };
}

/**
 * Put the visitor's name into a line the business wrote — "Hi {name} 👋".
 *
 * Shared rather than written twice because the settings preview has to agree
 * with the widget about what the admin is going to get, down to the spacing.
 *
 * A missing name leaves the sentence still readable: the token goes, and the
 * space it leaves behind goes with it, so "Hi {name} 👋" reads "Hi 👋" for a
 * visitor who never gave one rather than "Hi  👋". Only the first name is used
 * — a greeting that says "Hi Nathan Amos" reads like a letter from a bank.
 */
export function fillVisitorName(text: string, name?: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return text.replace(/\s*\{name\}/g, "").replace(/\s{2,}/g, " ").trim();
  return text.replace(/\{name\}/g, first);
}

/**
 * One of the people who answers this chat, as a visitor may see them.
 *
 * A first name and a face — nothing else. Not their email, not their role, not
 * whether they are the one who will actually pick it up: this exists to show
 * that a person is on the other end, which is the whole reason a chat widget
 * outperforms a contact form.
 */
export const nestchatAgentFaceSchema = z.object({
  /** Display name, trimmed to a first name — a visitor doesn't need a surname. */
  name: z.string(),
  initials: z.string(),
  /** Their avatar colour, so the fallback circle is theirs and not a generic grey. */
  color: z.string().optional(),
  /** A path the widget can load their photo from, when they have one. Relative,
   *  because it is resolved against whichever origin served the widget. */
  avatarUrl: z.string().optional(),
  online: z.boolean(),
});
export type NestChatAgentFace = z.infer<typeof nestchatAgentFaceSchema>;

/** The team behind a channel: a few faces, and how many there are in all. */
export const nestchatTeamSchema = z.object({
  name: z.string().optional(),
  faces: z.array(nestchatAgentFaceSchema),
  total: z.number().int().nonnegative(),
});
export type NestChatTeam = z.infer<typeof nestchatTeamSchema>;

/** What the agent-facing settings pane reads for one NestChat channel. */
export const nestchatSettingsSchema = z.object({
  inboxId: z.string(),
  /** Public id in the embed snippet. Identifies the inbox; authorises nothing. */
  widgetKey: z.string(),
  appearance: nestchatAppearanceSchema,
  preChat: nestchatPreChatSchema,
  routing: nestchatRoutingSchema,
  home: nestchatHomeSchema,
  /**
   * The teams this channel routes to — the only teams a routing option may
   * name, so the pane can offer exactly those and no more.
   *
   * Sent with the settings rather than fetched separately because the pane
   * needs the *intersection* of the org's teams and this channel's, and the
   * channel is the half only the server knows without another round trip.
   */
  teams: z
    .array(z.object({ id: z.string(), name: z.string(), icon: z.string().nullable().optional() }))
    .default([]),
  /** Ready-to-paste URLs, resolved against the deployment's own public URL so
   *  the snippet is correct without the admin knowing where we're hosted. */
  embedUrl: z.string(),
  scriptUrl: z.string(),
  /** The same faces the widget would show, so the preview shows them too — a
   *  toggle that changes nothing on screen reads as a toggle that didn't work. */
  team: nestchatTeamSchema.optional(),
});
export type NestChatSettings = z.infer<typeof nestchatSettingsSchema>;

/**
 * A settings save.
 *
 * `appearance` is a patch, as it always was — it is a flat bag of independent
 * strings and toggles, and merging one key over the rest is well defined.
 *
 * `preChat` and `routing` are replaced whole. They contain a list and nested
 * objects, and "merge" has no honest meaning for those: patching an array of
 * routing options can't express a deletion, and a caller who sent one option
 * would find the other seven still there. The pane holds the whole structure
 * anyway, so sending it costs nothing and removes the ambiguity.
 */
export const updateNestchatInputSchema = z.object({
  appearance: nestchatAppearanceSchema.partial().optional(),
  preChat: nestchatPreChatSchema.optional(),
  routing: nestchatRoutingSchema.optional(),
  home: nestchatHomeSchema.optional(),
});
export type UpdateNestchatInput = z.infer<typeof updateNestchatInputSchema>;

/* ---- the visitor-facing contract (public, unauthenticated) ---- */

/** What the widget fetches before it renders anything. No customer data. */
export const nestchatConfigSchema = z.object({
  appearance: nestchatAppearanceSchema,
  /** Whether anyone is at the desk right now, so the widget can set
   *  expectations instead of promising a reply nobody is there to send. */
  online: z.boolean(),
  /** The team behind this channel: a few faces, and how many there are in all. */
  team: nestchatTeamSchema.optional(),
  /**
   * The form to show before the first message, when the business asked for one.
   *
   * Absent rather than disabled when it is off: the widget's question is "is
   * there a form?", and a channel that doesn't want one shouldn't ship six
   * labels to every visitor's browser to say so.
   */
  preChat: nestchatPreChatSchema.optional(),
  /** The menu of things a visitor can say they're here about. Absent when the
   *  channel has no menu, or has one with nothing in it. */
  routing: nestchatPublicRoutingSchema.optional(),
  /** The cards to show before the conversation. Absent when the channel has no
   *  home screen, so the widget's question stays "is there one?". */
  home: nestchatHomeSchema.optional(),
});
export type NestChatConfig = z.infer<typeof nestchatConfigSchema>;

/**
 * One message as a visitor may see it. Deliberately not `Message`: the internal
 * shape carries notes, assignment, delivery state and author ids, none of which
 * belong on someone else's website. Everything the widget renders is built here.
 */
export const nestchatMessageSchema = z.object({
  id: z.string(),
  from: z.enum(["visitor", "agent"]),
  /** The agent's display name, for the "Sarah" above a reply. Absent for the
   *  visitor's own messages. */
  authorName: z.string().optional(),
  body: z.string(),
  at: z.string(),
  attachments: z
    .array(z.object({ id: z.string(), filename: z.string(), mime: z.string() }))
    .optional(),
});
export type NestChatMessage = z.infer<typeof nestchatMessageSchema>;

/** Opening (or resuming) a chat. The visitor id is the browser's own, so a
 *  returning visitor lands back in their existing conversation. */
export const nestchatSessionInputSchema = z.object({
  visitorId: z.string().min(8).max(64).optional(),
  name: z.string().max(80).optional(),
});
export type NestChatSessionInput = z.infer<typeof nestchatSessionInputSchema>;

export const nestchatSessionSchema = z.object({
  visitorId: z.string(),
  /** Bearer for every later visitor call. Scoped to one conversation. */
  token: z.string(),
  /** Whether this visitor already has a thread. False for someone who has
   *  opened the widget but never written — there is nothing to stream yet, and
   *  a widget that opens one anyway reconnects against a 400 forever. */
  hasConversation: z.boolean(),
  messages: z.array(nestchatMessageSchema),
});
export type NestChatSession = z.infer<typeof nestchatSessionSchema>;

export const nestchatSendInputSchema = z.object({
  body: z.string().min(1).max(4000),
  /** The page the widget is embedded on. Recorded as the subject of the thread
   *  this message opens, so the agent can see where the visitor was standing. */
  pageUrl: z.string().max(500).optional(),
});
export type NestChatSendInput = z.infer<typeof nestchatSendInputSchema>;

/** The visitor's widget reporting how far it has actually got through the
 *  thread — what turns an agent's ticks from sent to delivered to read. */
export const nestchatReadInputSchema = z.object({
  /** The newest message the widget has. Everything up to it moves. */
  throughMessageId: z.string().min(1),
  /** "delivered" — it arrived in their browser. "read" — the chat was actually
   *  on screen when it did, which is a different claim and the only one worth
   *  showing an agent as read. */
  status: z.enum(["delivered", "read"]),
});
export type NestChatReadInput = z.infer<typeof nestchatReadInputSchema>;

/**
 * How much of a visitor's unsent draft travels, and how often.
 *
 * The cap is a socket-traffic bound, not an editorial one: someone pasting an
 * order history into the box shouldn't push a kilobyte through the gateway on
 * every keystroke, and the agent only needs enough to know what's coming. The
 * interval is the trade between feeling live and one request per character —
 * under a second reads as live, and at this rate a solid minute of typing stays
 * inside the endpoint's rate limit.
 */
export const TYPING_PREVIEW_MAX = 500;
export const TYPING_PREVIEW_MS = 700;

export const nestchatTypingInputSchema = z.object({
  /** What they have written so far. Empty means the box is empty — still
   *  typing (they just deleted it), so the indicator stays but the text goes. */
  preview: z.string().max(TYPING_PREVIEW_MAX).optional(),
});
export type NestChatTypingInput = z.infer<typeof nestchatTypingInputSchema>;

export const nestchatIdentifyInputSchema = z.object({
  name: z.string().max(80).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).optional(),
});
export type NestChatIdentifyInput = z.infer<typeof nestchatIdentifyInputSchema>;

/**
 * What came of it.
 *
 * `token` is reissued when the details turned out to belong to a customer we
 * already knew: this visitor IS that person, so their conversation moves onto
 * the existing record and the old contact — the one the visitor's token named —
 * no longer exists. A widget that kept its old token would be holding a
 * reference to a deleted row.
 *
 * `saved` is what the widget confirms back to the visitor. It used to report
 * nothing at all, which meant a details form that quietly failed looked exactly
 * like one that worked.
 */
export const nestchatIdentifyResultSchema = z.object({
  ok: z.boolean(),
  saved: z.array(z.enum(["name", "email", "phone"])),
  /** True when these details matched a customer already on file. */
  linked: z.boolean(),
  token: z.string().optional(),
});
export type NestChatIdentifyResult = z.infer<typeof nestchatIdentifyResultSchema>;

/**
 * The pre-chat form, submitted.
 *
 * Everything `identify` takes, plus which option they picked — one call rather
 * than two, because these are answers to one form and half-applying them (the
 * name saved, the routing lost) would put a visitor in front of the wrong team
 * under their own name.
 */
export const nestchatStartInputSchema = z.object({
  name: z.string().max(80).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).optional(),
  /** The id of the routing option they chose, if the channel offers a menu. */
  optionId: z.string().max(40).optional(),
});
export type NestChatStartInput = z.infer<typeof nestchatStartInputSchema>;

/**
 * What the form produced.
 *
 * Extends the identify result because the identity half is literally the same
 * operation — including the reissued `token`, which here does double duty: it
 * carries the surviving contact after a merge AND the routing choice, so the
 * choice survives a reload and can't be swapped by editing a later request.
 */
export const nestchatStartResultSchema = nestchatIdentifyResultSchema.extend({
  /**
   * The chosen option, echoed back after the server has checked it is really
   * one of this channel's.
   *
   * Echoed rather than assumed because the server is the one that decides: an
   * option removed while a visitor sat with the widget open resolves to
   * nothing, and the widget should show what will actually happen.
   */
  option: z.object({ id: z.string(), label: z.string() }).optional(),
  /** The faces of the team that will now answer, so the header can narrow from
   *  "everyone here" to "the people who handle billing". */
  team: nestchatTeamSchema.optional(),
});
export type NestChatStartResult = z.infer<typeof nestchatStartResultSchema>;

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

/**
 * A bulk import of customers, one entry per row of the uploaded file.
 *
 * Deliberately the same shape as a single create, so the import path and the
 * Add-customer form cannot drift into two different ideas of what a customer
 * is — including the get-or-create dedup, which is the whole reason importing
 * the same list twice is safe.
 *
 * Capped at 2000. Not a technical limit: the request is one transaction's worth
 * of work and a bigger file almost always means someone exported their whole
 * CRM by accident, which is better refused than half-applied.
 */
export const importContactsInputSchema = z.object({
  contacts: z.array(createContactInputSchema).min(1).max(2000),
  /** Applied to every row — including rows that matched a customer already on
   *  file, which is the point of tagging an import. Merged with whatever tags
   *  they have; nothing is removed. */
  tags: z.array(z.string()).default([]),
});
export type ImportContactsInput = z.infer<typeof importContactsInputSchema>;

/** What an import did, per outcome. `failed` carries the row's position in the
 *  file so a rejection can be pointed at rather than just counted. */
export const importContactsResultSchema = z.object({
  created: z.number().int().nonnegative(),
  /** Matched an existing customer by phone/email; tags were added to them. */
  matched: z.number().int().nonnegative(),
  failed: z.array(z.object({ index: z.number().int(), name: z.string(), error: z.string() })),
});
export type ImportContactsResult = z.infer<typeof importContactsResultSchema>;

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
  /**
   * Conversations this person has silenced.
   *
   * Kept here rather than in its own table because a mute belongs to a person,
   * not to the thread — two agents on the same busy group should be able to
   * disagree about whether it buzzes. Capped so a long career of muting can't
   * grow the row without bound; the oldest fall off first, which is the right
   * end to lose since a thread muted a year ago is almost certainly resolved.
   */
  mutedConversationIds: z.array(z.string()).max(200).default([]),
});
export type PushPreferences = z.infer<typeof pushPreferencesSchema>;

/** Body for PATCH /devices/mute/:conversationId. */
export const setConversationMutedInputSchema = z.object({ muted: z.boolean() });
export type SetConversationMutedInput = z.infer<typeof setConversationMutedInputSchema>;

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
  /** Token clients only: the half-authenticated token to post back with the
   *  code. Browsers get the same thing as a short-lived cookie instead. */
  pendingToken?: string;
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
  /** Push notifications to the phone app, and the Firebase project they travel
   *  through. `configured` is about the Expo access token, which is the only
   *  credential the API itself holds — the Firebase values are identifiers. */
  push: z.object({
    /** True when an Expo access token is set, so sends are authenticated. */
    configured: z.boolean(),
    /** The Firebase project id, e.g. "nestconnect-d5489". */
    projectId: z.string(),
    /** The FCM sender id — `project_number` in google-services.json. */
    projectNumber: z.string(),
    /** The Android app's `mobilesdk_app_id`. */
    appId: z.string(),
    storageBucket: z.string(),
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
  /** Push. The Firebase identifiers write on any change (empty clears, falling
   *  back to the environment); the Expo access token is written only when a
   *  non-empty value is sent, so it can be left blank to keep the stored one. */
  expoAccessToken: z.string().optional(),
  firebaseProjectId: z.string().optional(),
  firebaseProjectNumber: z.string().optional(),
  firebaseAppId: z.string().optional(),
  firebaseStorageBucket: z.string().optional(),
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
  /**
   * Somebody is writing on this thread.
   *
   * `preview` is what they have typed so far, and only ever comes from a
   * NestChat visitor: our own widget is the one place we hold the draft, and a
   * live chat is the one place seeing it early is worth anything — you can be
   * looking something up before they finish asking. WhatsApp and email give us
   * nothing to show, and an agent's own half-written reply is deliberately not
   * broadcast to their colleagues: watching a teammate type and retype is
   * surveillance, not presence. Never stored — it exists between two sockets.
   */
  [ServerEvent.Typing]: (p: {
    conversationId: string;
    who: string;
    typing: boolean;
    preview?: string;
  }) => void;
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
