import type {
  Attachment,
  AttachmentKind,
  ChannelType,
  Contact,
  ContactDuplicateGroup,
  ContactWithConversations,
  Conversation,
  ConversationPage,
  ConversationStatus,
  ConversationWithMessages,
  CreateTemplateInput,
  Inbox,
  Label,
  Member,
  Message,
  MessagePage,
  MessageStatus,
  MessageType,
  Notification,
  Participant,
  ParticipantRole,
  Priority,
  Role,
  RoutingStrategy,
  Team,
  Template,
  UpdateTemplateInput,
  User,
} from "@ding/schemas";

export interface ViewItem {
  key: string;
  title: string;
  count: number;
  channel?: ChannelType;
  handle?: string;
  /** For a WhatsApp number: the group conversations it hosts (nested in the sidebar). */
  groups?: { id: string; title: string }[];
  /** For "Later": how many snoozed items are now due (wake time passed). */
  due?: number;
  /** For a label view: its swatch colour. */
  color?: string;
}

export interface SidebarViews {
  my: ViewItem[];
  shared: { teams: ViewItem[]; inboxes: ViewItem[]; labels: ViewItem[] };
}

/** A sign-in session row, as the store returns it (dates are ISO strings). */
export interface StoredSession {
  id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

/** A user's two-factor state (the TOTP secret is encrypted at rest). */
export interface TwoFactorState {
  enabled: boolean;
  method: string | null; // "totp" | "email"
  totpSecret: string | null;
  emailCodeHash: string | null;
  emailCodeExpires: string | null;
}

/** Canonical inbound message handed to the store by a channel gateway. */
export interface InboundContact {
  kind: "phone" | "email" | "wa_id";
  value: string;
  displayName: string;
}

/** A media file to store on a message (the storage key is already written). */
export interface AttachmentInput {
  storageKey: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  filename: string;
  durationMs?: number;
  width?: number;
  height?: number;
  waveform?: number[];
}

export interface AppendInboundInput {
  authorName?: string;
  body: string;
  /** Sanitized HTML body for a rich inbound email (already scrubbed). */
  bodyHtml?: string;
  channelMsgId?: string;
  /** The channel this inbound message arrived on (thread may span channels). */
  channel?: ChannelType;
  messageType?: MessageType;
  attachments?: AttachmentInput[];
  /** Id of the message this inbound one quotes/replies to (already resolved). */
  quotedMsgId?: string;
}

/** What the media-serving endpoint needs to stream a stored file. */
export interface StoredAttachmentRef {
  storageKey: string;
  mime: string;
  filename: string;
}

/** Channel-specific hints persisted so an outbound message can be (re)sent from
 *  the DB alone after a restart — no reliance on in-flight job payloads. */
export interface OutboundDeliveryMeta {
  template?: { name: string; language: string; params: string[] };
  /** Email subject this message was sent with (email channel only). */
  subject?: string;
  cc?: string[];
  bcc?: string[];
  /** The sender's HTML signature, snapshotted at send time. Appended to the
   *  outbound email body only — never stored on the message shown in-app. */
  signatureHtml?: string;
  /** Forward recipients (email channel). When set, the send is routed to these
   *  addresses as a fresh "Fwd:" email — a new thread, not a reply to the
   *  customer — while still logged in the current conversation. First address is
   *  the To; any others are Cc. */
  forwardTo?: string[];
}

/** A per-recipient email open-tracking row to register at send time (one per
 *  To/Cc address; `token` is the unguessable id embedded in its pixel URL). */
export interface EmailRecipientInput {
  address: string;
  kind: "to" | "cc";
  token: string;
}

/**
 * Ignore email "opens" that arrive within this window of sending. A near-instant
 * pixel request is almost never a human read — it's an image proxy pre-caching
 * the image (most notably Gmail's GoogleImageProxy, which fetches images the
 * moment a message lands, not when it's opened). A real "the customer read it"
 * essentially never arrives this fast, so treating early hits as opens produces
 * a false "Seen" the instant you send. Suppressing them removes that.
 */
export const EMAIL_OPEN_GRACE_MS = 45_000;

/** The minimal record the delivery worker needs to (re)send an outbound message. */
export interface OutboundMessageRef {
  messageId: string;
  conversationId: string;
  status: MessageStatus;
  channelMsgId?: string;
  internal: boolean;
  deliveryMeta?: OutboundDeliveryMeta;
}

/** A message status change to broadcast (returned by the delivery-state writers). */
export interface MessageStatusChange {
  conversationId: string;
  message: Message;
}

/** A recorded inbound-webhook problem (unmapped account, bad signature, …). */
export interface WebhookDiagnostic {
  id: string;
  channel: string;
  kind: string;
  reference?: string;
  detail?: string;
  createdAt: string;
}

/** Filter for an analytics query. Null on any field = no filter for that dimension. */
export interface AnalyticsQuery {
  from: string; // ISO, inclusive
  to: string; // ISO, exclusive
  channel?: ChannelType | null;
  teamId?: string | null;
  agentUserId?: string | null;
}

/** One conversation created in the window, with the per-thread facts analytics
 *  needs (first response, message counts, labels) already derived by the store. */
export interface AnalyticsConvo {
  id: string;
  channel: ChannelType;
  status: ConversationStatus;
  assigneeUserId: string | null;
  assignedTeamId: string | null;
  priority: Priority;
  createdAt: string;
  lastActivityAt: string;
  /** First inbound (customer) message time; null if none. */
  firstInboundAt: string | null;
  /** First agent reply (non-internal outbound) time; null if unanswered. */
  firstReplyAt: string | null;
  /** Author of that first reply, for the per-agent response-time leaderboard. */
  firstReplyUserId: string | null;
  labelIds: string[];
  inbound: number;
  outbound: number;
}

/** One message sent/received in the window (lightweight, for series + heatmap). */
export interface AnalyticsMsg {
  createdAt: string;
  direction: "in" | "out";
  internal: boolean;
  authorUserId: string | null;
  channel: ChannelType;
}

/** The raw materials the analytics service aggregates into an AnalyticsResult.
 *  `conversations` are those CREATED in the window; `messages` are those SENT in
 *  it (their conversation may be older). Both respect the query's filters. */
export interface AnalyticsBundle {
  conversations: AnalyticsConvo[];
  messages: AnalyticsMsg[];
  /** Contacts created in the window (org-wide; not channel/team filtered). */
  newContacts: number;
  /** Current status counts across the filtered conversation set (not windowed). */
  snapshot: { open: number; pending: number; snoozed: number; closed: number; unassigned: number; total: number };
}

/**
 * The data-access contract for the platform. Two implementations exist:
 * `MemoryStore` (zero-infra fixtures) and `PrismaStore` (Postgres). Services
 * depend on this abstract token, never on a concrete store — so persistence is
 * a swap in `DataModule`, nothing more.
 */
export abstract class Store {
  /** The current demo user until real auth resolves identity per-request. */
  abstract get demoUserId(): string;

  /** Cheap liveness probe of the persistence layer (SELECT 1 / no-op). */
  abstract healthCheck(): Promise<boolean>;

  abstract getUser(id: string): Promise<User | undefined>;
  abstract findUserByEmail(email: string): Promise<User | undefined>;
  abstract getPasswordHash(userId: string): Promise<string | undefined>;
  abstract teamsForUser(userId: string): Promise<string[]>;
  abstract me(userId: string): Promise<{ user?: User; teams: Team[] }>;
  abstract listInboxes(): Promise<Inbox[]>;
  abstract createInbox(params: {
    orgId: string;
    type: ChannelType;
    name: string;
    handle: string;
    teamIds: string[];
    routingStrategy: RoutingStrategy;
    channelConfig?: Record<string, string>;
  }): Promise<Inbox>;
  /** Edit a channel: rename, re-route, change strategy, merge new credentials. */
  abstract updateInbox(
    id: string,
    params: {
      name?: string;
      teamIds?: string[];
      routingStrategy?: RoutingStrategy;
      channelConfig?: Record<string, string>;
    },
  ): Promise<Inbox | undefined>;
  /** Delete a channel and the conversations that belong to it. */
  abstract deleteInbox(id: string): Promise<void>;
  /** A single inbox by id (includes orgId/type; channelConfig stays backend-only). */
  abstract getInbox(id: string): Promise<Inbox | undefined>;
  /** The raw integration credentials for an inbox (backend-only — tokens etc.). */
  abstract getInboxConfig(id: string): Promise<Record<string, string> | undefined>;

  /* ---- app-level settings (org-scoped key/value) ---- */
  /** Read an org-scoped app setting (e.g. the Google OAuth client id/secret). */
  abstract getAppSetting(orgId: string, key: string): Promise<string | undefined>;
  /** Create or update an org-scoped app setting. */
  abstract setAppSetting(orgId: string, key: string, value: string): Promise<void>;

  /* ---- WhatsApp message templates (org-scoped) ---- */
  abstract listTemplates(orgId: string): Promise<Template[]>;
  abstract getTemplate(id: string): Promise<Template | undefined>;
  abstract createTemplate(orgId: string, input: CreateTemplateInput): Promise<Template>;
  abstract updateTemplate(id: string, input: UpdateTemplateInput): Promise<Template | undefined>;
  abstract deleteTemplate(id: string): Promise<void>;
  /** Upsert a template synced from Meta, keyed by (orgId, name, language). */
  abstract upsertTemplateByName(
    orgId: string,
    input: CreateTemplateInput & { approvalStatus: Template["approvalStatus"] },
  ): Promise<Template>;

  /* ---- settings: teams & people ---- */
  abstract listTeams(): Promise<Team[]>;
  abstract listMembers(): Promise<Member[]>;
  abstract createTeam(params: { orgId: string; name: string; icon?: string; slaMinutes?: number | null }): Promise<Team>;
  abstract updateTeam(
    id: string,
    params: { name?: string; icon?: string | null; slaMinutes?: number | null },
  ): Promise<Team | undefined>;
  /** Fetch a single team by id (used to resolve its SLA target). */
  abstract getTeam(id: string): Promise<Team | undefined>;
  /** Delete a team, detaching its members, inbox routing and any assignments. */
  abstract deleteTeam(id: string): Promise<void>;
  /** Persist a new team ordering; ids not present keep their relative order after. */
  abstract reorderTeams(orderedIds: string[]): Promise<Team[]>;
  /**
   * Create a user. With `password` set (seeding) the account can log in straight
   * away; without it, a single-use invite token is minted and returned so the
   * invitee can set their own password — the account has no usable password
   * until they do.
   */
  abstract createUser(params: {
    orgId: string;
    name: string;
    email: string;
    role: Role;
    teamIds: string[];
    password?: string;
  }): Promise<{ user: User; inviteToken?: string }>;
  /** Consume an invite token, set the user's password, and return the user. */
  abstract setPasswordByInviteToken(token: string, password: string): Promise<User | undefined>;
  /**
   * Mint a fresh single-use token for an EXISTING user by email — used by
   * "forgot password". Reuses the invite-token storage + set-password flow.
   * Returns the raw token + user, or null when no such user exists (the caller
   * still responds success either way, to avoid leaking which emails exist).
   */
  abstract createPasswordResetToken(email: string): Promise<{ user: User; token: string } | null>;
  abstract updateUser(
    id: string,
    params: { name?: string; role?: Role; teamIds?: string[] },
  ): Promise<User | undefined>;
  /** A user updating their OWN personal settings (availability + signature). */
  abstract updateMyPreferences(
    userId: string,
    params: { available?: boolean; emailSignature?: string | null },
  ): Promise<User | undefined>;
  /** A user updating their OWN profile (name, login email, photo). Email
   *  uniqueness within the org is enforced by the caller. */
  abstract updateMyProfile(
    userId: string,
    params: { name?: string; email?: string; avatarUrl?: string | null },
  ): Promise<User | undefined>;
  /** Set a user's password to a new plaintext value (hashed in the store). */
  abstract setUserPassword(userId: string, password: string): Promise<void>;
  /** Remove a person, detaching their team memberships and clearing assignments. */
  abstract deleteUser(id: string): Promise<void>;

  /* ---- sign-in sessions ("where you're logged in" + remote sign-out) ---- */

  /** Record a new signed-in device; its id becomes the JWT's `jti`. */
  abstract createSession(userId: string, meta: { ip?: string; userAgent?: string }): Promise<StoredSession>;
  /** Fetch a session by id (for the guard's revocation check). */
  abstract getSession(id: string): Promise<StoredSession | undefined>;
  /** A user's sessions, active first, newest first (for the settings list). */
  abstract listSessions(userId: string): Promise<StoredSession[]>;
  /** Bump a session's lastSeenAt (throttled by the caller). */
  abstract touchSession(id: string): Promise<void>;
  /** Revoke one of a user's own sessions. Returns false if it isn't theirs. */
  abstract revokeSession(userId: string, id: string): Promise<boolean>;
  /** Revoke all of a user's sessions except `keepId`; returns the count revoked. */
  abstract revokeOtherSessions(userId: string, keepId: string): Promise<number>;

  /* ---- two-factor auth ---- */

  /** A user's 2FA state (undefined if the user doesn't exist). */
  abstract getTwoFactor(userId: string): Promise<TwoFactorState | undefined>;
  /** Patch any subset of a user's 2FA fields. */
  abstract updateTwoFactor(userId: string, patch: Partial<TwoFactorState>): Promise<void>;
  /** A user's recovery codes (hashed), for verification/counting. */
  abstract listRecoveryCodes(userId: string): Promise<{ id: string; codeHash: string; usedAt: string | null }[]>;
  /** Replace a user's recovery codes with a fresh hashed set. */
  abstract replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void>;
  /** Mark one recovery code spent so it can't be reused. */
  abstract markRecoveryCodeUsed(id: string): Promise<void>;
  abstract views(userId: string): Promise<SidebarViews>;
  /** A cursor page of conversations for a view (most-recent first). */
  abstract listConversations(
    view: string,
    userId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage>;
  /** A cursor page of search results (contact, subject, preview, message body). */
  abstract searchConversations(
    query: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage>;
  /** A conversation with its most-recent page of messages (+ hasMoreMessages). */
  abstract getConversation(id: string): Promise<ConversationWithMessages | undefined>;
  /** Older messages in a thread, before `opts.before` (a seq cursor). For scroll-up. */
  abstract listMessages(
    conversationId: string,
    opts?: { before?: string; limit?: number },
  ): Promise<MessagePage>;

  abstract addMessage(
    conversationId: string,
    input: {
      body: string;
      bodyHtml?: string;
      internal: boolean;
      attachmentIds?: string[];
      quotedMsgId?: string;
      /** Reply on a specific channel (cross-channel thread); defaults to the
       *  conversation's channel. */
      channel?: ChannelType;
      /** Dedup key for the delivery job (also the queue jobId). */
      idempotencyKey?: string;
      /** Channel-specific send hints, persisted for restart-safe (re)delivery. */
      deliveryMeta?: OutboundDeliveryMeta;
    },
    author: User,
  ): Promise<Message | undefined>;

  /** Resolve a provider message id (WhatsApp wamid) to our stored message. */
  abstract getMessageRefByChannelId(
    channelMsgId: string,
  ): Promise<{ id: string; conversationId: string } | undefined>;

  /** Set/replace/remove a reaction (empty emoji removes) for a participant. */
  abstract reactToMessage(
    messageId: string,
    emoji: string,
    by: "contact" | "user",
  ): Promise<{ conversationId: string; message: Message } | undefined>;

  /** Stage an uploaded file as an attachment not yet tied to a message. */
  abstract createUploadAttachment(orgId: string, input: AttachmentInput): Promise<Attachment>;

  abstract assign(
    conversationId: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
    byUserId?: string,
  ): Promise<Conversation | undefined>;

  /**
   * Move an inbox's open/pending conversations that sit on a team it no longer
   * routes to onto its current primary team (per-customer pins still win). Used
   * when an admin changes a channel's routing and wants existing chats to follow.
   * Returns how many were moved.
   */
  abstract rerouteInboxConversations(inboxId: string): Promise<number>;

  /** Change a conversation's status (close/resolve, reopen, snooze). */
  abstract setStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation | undefined>;

  /** Set a conversation's priority (low/normal/high/urgent). */
  abstract setPriority(
    conversationId: string,
    priority: Priority,
  ): Promise<Conversation | undefined>;

  /** Set (or clear, with null) a conversation's subject — the email thread's
   *  subject line, editable from the composer. */
  abstract setSubject(
    conversationId: string,
    subject: string | null,
  ): Promise<Conversation | undefined>;

  /** Set a group conversation's shareable invite link (after create/reset). */
  abstract setInviteLink(
    conversationId: string,
    inviteLink: string,
  ): Promise<Conversation | undefined>;

  /** Point a conversation at a different channel inbox — used when a customer's
   *  most-recent message arrives on another channel of the same thread, so the
   *  chat shows under the channel they're actually using now (not the origin).
   *  A no-op that returns undefined when the inbox is already set. */
  abstract setConversationInbox(
    conversationId: string,
    inboxId: string,
  ): Promise<Conversation | undefined>;

  /** Persist a provider thread reference on a conversation — for email, the Gmail
   *  server-side thread id, so an outbound reply is sent back into the same thread.
   *  A no-op returning undefined when the conversation is unknown or already set. */
  abstract setConversationChannelRef(
    conversationId: string,
    channelRef: string,
  ): Promise<Conversation | undefined>;

  /** Set (or clear) a conversation's first-response SLA due time (ISO or null). */
  abstract setSla(
    conversationId: string,
    dueAt: string | null,
  ): Promise<Conversation | undefined>;

  /** Snooze a conversation until `until` (ISO); it wakes back into the queue then. */
  abstract snooze(conversationId: string, until: string): Promise<Conversation | undefined>;

  /** Snoozed conversations whose wake time has passed — driven by the sweep that
   *  wakes them and raises a "due" notification for the assignee. */
  abstract listDueSnoozed(): Promise<Conversation[]>;
  /** Wake a due snoozed conversation back to "open" while KEEPING its snooze
   *  timestamp as a "came back from Later" marker (the list shows a badge off
   *  it; it's cleared when the agent opens the conversation). No-op unless the
   *  conversation is currently snoozed. */
  abstract wakeSnoozed(conversationId: string): Promise<Conversation | undefined>;

  /* ---- Notifications (the bell) ---- */
  abstract createNotification(input: {
    userId: string;
    type: Notification["type"];
    title: string;
    body?: string;
    conversationId?: string | null;
  }): Promise<Notification>;
  /** A user's recent notifications, newest first (capped). */
  abstract listNotifications(userId: string, limit?: number): Promise<Notification[]>;
  /** Mark some (or, when `ids` is omitted, all) of a user's notifications read. */
  abstract markNotificationsRead(userId: string, ids?: string[]): Promise<void>;

  /** Record a provider-side id on an outbound message (for status reconciliation). */
  abstract setMessageChannelId(messageId: string, channelMsgId: string): Promise<void>;

  /* ---- durable outbound delivery ---- */

  /** Everything the delivery worker needs to (re)send a message by its id. */
  abstract getOutboundMessage(messageId: string): Promise<OutboundMessageRef | undefined>;

  /** Begin a send attempt: status→sending, attemptCount++, lastAttemptAt=now.
   *  Returns undefined if the message is gone or already past the sending stage. */
  abstract markMessageSending(messageId: string): Promise<MessageStatusChange | undefined>;

  /** Provider accepted the send: persist its channel id (if any) and advance to
   *  "sent", clearing any recorded error. Guarded by the status ladder. */
  abstract markMessageSent(
    messageId: string,
    channelMsgId?: string,
  ): Promise<MessageStatusChange | undefined>;

  /* ---- per-recipient email open tracking (read receipts) ---- */
  /** Register the tracking rows for an outbound email — one per To/Cc address,
   *  each with its own pixel token — so an open can be attributed to a person. */
  abstract registerEmailRecipients(
    messageId: string,
    recipients: EmailRecipientInput[],
  ): Promise<void>;

  /** Record an email open by its pixel token: stamp `openedAt` the first time and
   *  bump the open count. Returns the affected message (so the caller can
   *  broadcast the "Seen") ONLY on the first open of that recipient — undefined
   *  for a repeat open or an unknown token. */
  abstract recordEmailOpen(token: string): Promise<MessageStatusChange | undefined>;

  /** Record a failed send attempt. `permanent` flips the message to failed
   *  (terminal) with `reason`; otherwise it stays in flight for the queue to
   *  retry, and only the diagnostics (error/code) are recorded. */
  abstract recordSendFailure(
    messageId: string,
    info: { error?: string; code?: string; permanent: boolean; reason?: string },
  ): Promise<MessageStatusChange | undefined>;

  /** Outbound messages still in flight (queued/sending) whose last attempt is
   *  older than `olderThanMs` — used to re-enqueue after a restart/crash. The
   *  idempotency key rides along so the re-enqueue reuses the same job identity. */
  abstract listStuckOutbound(
    olderThanMs: number,
  ): Promise<Array<{ messageId: string; conversationId: string; idempotencyKey?: string }>>;

  /** Reset a failed message to queued for a manual retry (new idempotency key,
   *  failure fields cleared). Returns undefined if it isn't in a retryable state. */
  abstract resetMessageForRetry(
    messageId: string,
    idempotencyKey: string,
  ): Promise<MessageStatusChange | undefined>;

  /** Clear a conversation's unread flag + count (agent opened/read it). */
  abstract clearUnread(conversationId: string): Promise<Conversation | undefined>;

  /** Flag a conversation unread with no count — an agent's manual "mark unread"
   *  (WhatsApp-style empty dot); distinct from unreadCount>0 from new messages. */
  abstract markUnread(conversationId: string): Promise<Conversation | undefined>;

  /* ---- labels (org catalog + per-conversation) ---- */
  /** The org's label catalog (name + colour), for the picker + sidebar filter. */
  abstract listLabels(orgId: string): Promise<Label[]>;
  abstract createLabel(input: { orgId: string; name: string; color: string }): Promise<Label>;
  abstract updateLabel(id: string, patch: { name?: string; color?: string }): Promise<Label | undefined>;
  /** Delete a label from the catalog and remove it from every conversation. */
  abstract deleteLabel(id: string): Promise<void>;
  /** Replace a conversation's labels with exactly this set of label ids. */
  abstract setConversationLabels(conversationId: string, labelIds: string[]): Promise<Conversation | undefined>;

  /* ---- channel ingestion (inbound) ---- */

  abstract getInboxByWhatsAppPhoneId(phoneNumberId: string): Promise<Inbox | undefined>;
  abstract getInboxByEmailAddress(address: string): Promise<Inbox | undefined>;

  /* ---- webhook diagnostics (unmapped/unverified inbound) ---- */
  abstract recordWebhookDiagnostic(input: {
    channel: string;
    kind: string;
    reference?: string;
    detail?: string;
  }): Promise<void>;
  abstract listWebhookDiagnostics(limit?: number): Promise<WebhookDiagnostic[]>;
  abstract getMembers(teamId: string): Promise<User[]>;

  /** Threading: find the conversation owning any message with one of these provider ids. */
  abstract findConversationByMessageChannelIds(channelMsgIds: string[]): Promise<string | undefined>;

  abstract upsertContactByIdentity(params: {
    orgId: string;
    kind: "phone" | "email" | "wa_id";
    value: string;
    displayName: string;
    company?: string;
    avatarColor?: string;
  }): Promise<Contact>;

  /**
   * The open conversation for this contact ON THIS INBOX, or a new one if none.
   * Threading is per-inbox (channel endpoint): a customer reaching a different
   * number / email address / channel opens a SEPARATE conversation, and a closed
   * thread starts a new one — only one open per (contact, inbox) at a time.
   * (Agents can still reply cross-channel within a thread; that's the send path.)
   */
  abstract findOrCreateOpenConversation(params: {
    orgId: string;
    inboxId: string;
    contact: Contact;
    channel: ChannelType;
    subject?: string;
    assigneeUserId?: string | null;
    assignedTeamId?: string | null;
  }): Promise<{ conversation: Conversation; created: boolean }>;

  abstract appendInboundMessage(
    conversationId: string,
    input: AppendInboundInput,
  ): Promise<Message | undefined>;

  /** Record an outbound email that was sent straight from Gmail (not through
   *  Nest) into its conversation, so the thread stays complete. Stored as an
   *  already-sent outgoing message — no delivery is triggered. */
  abstract appendSyncedOutboundEmail(
    conversationId: string,
    input: {
      body: string;
      bodyHtml?: string;
      channelMsgId?: string;
      authorName?: string;
      attachments?: AttachmentInput[];
    },
  ): Promise<Message | undefined>;

  /** Backend-only: the storage key + mime of an attachment, for serving media. */
  abstract getAttachment(id: string): Promise<StoredAttachmentRef | undefined>;

  /** Media access info for the serving endpoint: the storage ref plus the org
   *  that owns it (via its message's conversation), for the authorization check.
   *  `orgId` is undefined for a staged upload not yet attached to a conversation. */
  abstract getAttachmentAccess(
    id: string,
  ): Promise<{ storageKey: string; mime: string; filename: string; orgId?: string } | undefined>;

  abstract updateMessageStatusByChannelId(
    channelMsgId: string,
    status: MessageStatus,
  ): Promise<{ conversationId: string; message: Message } | undefined>;

  /**
   * Mark an outbound message as failed by its internal id — used when a send is
   * rejected before the provider ever returns a channel id (bad address, no
   * provider, expired token). Guarded by the status ladder so it never drags a
   * message that already reached the customer back to failed.
   */
  abstract failMessage(
    messageId: string,
  ): Promise<{ conversationId: string; message: Message } | undefined>;

  /* ---- WhatsApp groups ---- */

  abstract findConversationByChannelRef(channelRef: string): Promise<string | undefined>;

  /**
   * Create a contact (a group's synthetic contact, or a customer added by hand),
   * OR return the existing one if the phone/email already resolves to a contact
   * in this org — `created` is false when an existing contact was returned.
   */
  abstract createContact(params: {
    orgId: string;
    displayName: string;
    avatarColor?: string;
    company?: string;
    phone?: string;
    email?: string;
    tags?: string[];
    ownerUserId?: string | null;
    ownerTeamId?: string | null;
  }): Promise<{ contact: Contact; created: boolean }>;

  /** One-time (idempotent) backfill of normalizedValue/orgId on identity rows. */
  abstract backfillIdentityNormalization(): Promise<{ updated: number }>;

  /**
   * Consolidate any residual duplicate customer identities — legacy rows that
   * share a canonical phone/email but were created before get-or-create dedup,
   * or missed in a manual merge — and then enforce the hard guarantee that no
   * two identities of the same kind in an org can share a normalised value.
   * Idempotent and safe to run on every boot; never removes a customer's only
   * copy of an identity. `constraintApplied` is false only if a residual
   * cross-contact collision blocked the unique index (app-level dedup still
   * prevents new duplicates in that case).
   */
  abstract reconcileIdentityUniqueness(): Promise<{
    mergedContacts: number;
    collapsedIdentities: number;
    constraintApplied: boolean;
  }>;

  /* ---- analytics (admin/manager insights) ---- */
  /** Raw analytics materials for an org over a window, filtered by
   *  channel/team/agent. Aggregation into the dashboard payload lives in the
   *  AnalyticsService so both stores share one set of derivations. */
  abstract getAnalytics(orgId: string, q: AnalyticsQuery): Promise<AnalyticsBundle>;

  /* ---- customers directory ---- */
  abstract listContacts(): Promise<Contact[]>;
  /** Clusters of contacts that probably represent the same customer (shared
   *  normalised phone/email), surfaced for review before merging. */
  abstract findDuplicateContacts(): Promise<ContactDuplicateGroup[]>;
  /** Merge duplicate contacts into `winnerId`: move the losers' identities,
   *  conversations and participations onto the winner, blank-fill its fields and
   *  union tags, then delete the losers. Returns the surviving contact. */
  abstract mergeContacts(params: { winnerId: string; loserIds: string[] }): Promise<Contact>;
  abstract getContactWithConversations(id: string): Promise<ContactWithConversations | undefined>;
  abstract updateContact(
    id: string,
    params: {
      displayName?: string;
      company?: string;
      phone?: string;
      email?: string;
      tags?: string[];
      ownerUserId?: string | null;
      ownerTeamId?: string | null;
      blocked?: boolean;
    },
  ): Promise<Contact | undefined>;

  /** Permanently delete a customer and everything attached to them
   *  (conversations, messages, identities, participations). */
  abstract deleteContact(id: string): Promise<void>;

  abstract createGroupConversation(params: {
    orgId: string;
    inboxId: string;
    contact: Contact;
    subject: string;
    channelRef: string;
    inviteLink: string;
    memberContacts: Contact[];
    assigneeUserId?: string | null;
    assignedTeamId?: string | null;
  }): Promise<Conversation>;

  abstract listParticipants(conversationId: string): Promise<Participant[]>;
  abstract countParticipants(conversationId: string): Promise<number>;
  abstract addParticipant(conversationId: string, contact: Contact, role?: ParticipantRole): Promise<Participant>;
  abstract removeParticipant(conversationId: string, contactId: string): Promise<void>;
}
