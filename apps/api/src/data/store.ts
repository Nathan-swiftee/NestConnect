import type {
  ChannelType,
  Contact,
  Conversation,
  ConversationWithMessages,
  Inbox,
  Message,
  MessageStatus,
  RoutingStrategy,
  Team,
  User,
} from "@ding/schemas";

export interface ViewItem {
  key: string;
  title: string;
  count: number;
  channel?: ChannelType;
  handle?: string;
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

export interface AppendInboundInput {
  authorName?: string;
  body: string;
  channelMsgId?: string;
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
  }): Promise<Inbox>;
  abstract views(userId: string): Promise<SidebarViews>;
  abstract listConversations(view: string, userId: string): Promise<Conversation[]>;
  abstract getConversation(id: string): Promise<ConversationWithMessages | undefined>;

  abstract addMessage(
    conversationId: string,
    input: { body: string; internal: boolean },
    author: User,
  ): Promise<Message | undefined>;

  abstract assign(
    conversationId: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
    byUserId?: string,
  ): Promise<Conversation | undefined>;

  /** Record a provider-side id on an outbound message (for status reconciliation). */
  abstract setMessageChannelId(messageId: string, channelMsgId: string): Promise<void>;

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

  abstract updateMessageStatusByChannelId(
    channelMsgId: string,
    status: MessageStatus,
  ): Promise<{ conversationId: string; message: Message } | undefined>;
}
