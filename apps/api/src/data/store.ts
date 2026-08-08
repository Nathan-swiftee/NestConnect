import type {
  Attachment,
  AttachmentKind,
  ChannelType,
  Contact,
  ContactWithConversations,
  Conversation,
  ConversationStatus,
  ConversationWithMessages,
  CreateTemplateInput,
  Inbox,
  Member,
  Message,
  MessageStatus,
  MessageType,
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
}

export interface SidebarViews {
  my: ViewItem[];
  shared: { teams: ViewItem[]; inboxes: ViewItem[] };
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

/**
 * The data-access contract for the platform. Two implementations exist:
 * `MemoryStore` (zero-infra fixtures) and `PrismaStore` (Postgres). Services
 * depend on this abstract token, never on a concrete store — so persistence is
 * a swap in `DataModule`, nothing more.
 */
export abstract class Store {
  /** The current demo user until real auth resolves identity per-request. */
  abstract get demoUserId(): string;

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
  abstract updateUser(
    id: string,
    params: { name?: string; role?: Role; teamIds?: string[] },
  ): Promise<User | undefined>;
  /** Remove a person, detaching their team memberships and clearing assignments. */
  abstract deleteUser(id: string): Promise<void>;
  abstract views(userId: string): Promise<SidebarViews>;
  abstract listConversations(view: string, userId: string): Promise<Conversation[]>;
  /** Search across all conversations by contact, subject, preview and message body. */
  abstract searchConversations(query: string): Promise<Conversation[]>;
  abstract getConversation(id: string): Promise<ConversationWithMessages | undefined>;

  abstract addMessage(
    conversationId: string,
    input: { body: string; bodyHtml?: string; internal: boolean; attachmentIds?: string[]; quotedMsgId?: string },
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

  /** Set (or clear) a conversation's first-response SLA due time (ISO or null). */
  abstract setSla(
    conversationId: string,
    dueAt: string | null,
  ): Promise<Conversation | undefined>;

  /** Snooze a conversation until `until` (ISO); it wakes back into the queue then. */
  abstract snooze(conversationId: string, until: string): Promise<Conversation | undefined>;

  /** Record a provider-side id on an outbound message (for status reconciliation). */
  abstract setMessageChannelId(messageId: string, channelMsgId: string): Promise<void>;

  /** Clear a conversation's unread flag + count (agent opened/read it). */
  abstract clearUnread(conversationId: string): Promise<Conversation | undefined>;

  /* ---- channel ingestion (inbound) ---- */

  abstract getInboxByWhatsAppPhoneId(phoneNumberId: string): Promise<Inbox | undefined>;
  abstract getInboxByEmailAddress(address: string): Promise<Inbox | undefined>;
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

  /** Backend-only: the storage key + mime of an attachment, for serving media. */
  abstract getAttachment(id: string): Promise<StoredAttachmentRef | undefined>;

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

  /** Create a contact (a group's synthetic contact, or a customer added by hand). */
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
  }): Promise<Contact>;

  /* ---- customers directory ---- */
  abstract listContacts(): Promise<Contact[]>;
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
    },
  ): Promise<Contact | undefined>;

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
