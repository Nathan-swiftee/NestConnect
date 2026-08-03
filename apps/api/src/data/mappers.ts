import type { Prisma } from "@prisma/client";
import type {
  ChannelType,
  Contact,
  Conversation,
  ConversationWithMessages,
  Inbox,
  Message,
  MessageStatus,
  Priority,
  RoutingStrategy,
  Team,
  User,
} from "@ding/schemas";

/* Prisma row → domain type mappers. Includes are typed via Prisma payload helpers. */

type ContactWithIdentities = Prisma.ContactGetPayload<{ include: { identities: true } }>;
type InboxWithTeams = Prisma.InboxGetPayload<{ include: { teams: true } }>;
type ConversationSummaryRow = Prisma.ConversationGetPayload<{
  include: { contact: { include: { identities: true } }; labels: { include: { label: true } } };
}>;
type ConversationFullRow = Prisma.ConversationGetPayload<{
  include: {
    contact: { include: { identities: true } };
    labels: { include: { label: true } };
    messages: true;
  };
}>;
type MessageRow = Prisma.MessageGetPayload<object>;

export function mapUser(u: Prisma.UserGetPayload<object>): User {
  return {
    id: u.id,
    orgId: u.orgId,
    name: u.name,
    email: u.email,
    role: u.role as User["role"],
    avatarColor: u.avatarColor ?? undefined,
    online: u.online,
  };
}

export function mapTeam(t: Prisma.TeamGetPayload<object>): Team {
  return { id: t.id, orgId: t.orgId, name: t.name };
}

export function mapInbox(i: InboxWithTeams): Inbox {
  return {
    id: i.id,
    orgId: i.orgId,
    type: i.type as ChannelType,
    name: i.name,
    handle: i.handle,
    teamIds: i.teams.map((t) => t.teamId),
    routingStrategy: i.routingStrategy as RoutingStrategy,
    unread: 0,
  };
}

export function mapContact(c: ContactWithIdentities): Contact {
  const phone = c.identities.find((x) => x.kind === "phone" || x.kind === "wa_id")?.value;
  const email = c.identities.find((x) => x.kind === "email")?.value;
  return {
    id: c.id,
    orgId: c.orgId,
    displayName: c.displayName,
    company: c.company ?? undefined,
    phone,
    email,
    avatarColor: c.avatarColor ?? undefined,
    ownerUserId: c.ownerUserId ?? undefined,
    ownerTeamId: c.ownerTeamId ?? undefined,
  };
}

export function mapMessage(m: MessageRow): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq,
    direction: m.direction as Message["direction"],
    authorType: m.authorType as Message["authorType"],
    authorName: m.authorName ?? undefined,
    body: m.body,
    status: m.status as MessageStatus,
    internal: m.internal,
    channelMsgId: m.channelMsgId ?? undefined,
    createdAt: m.createdAt.toISOString(),
  };
}

export function mapConversation(c: ConversationSummaryRow): Conversation {
  return {
    id: c.id,
    orgId: c.orgId,
    inboxId: c.inboxId,
    channel: c.channel as ChannelType,
    contact: mapContact(c.contact),
    status: c.status as Conversation["status"],
    assigneeUserId: c.assigneeUserId,
    assignedTeamId: c.assignedTeamId,
    priority: c.priority as Priority,
    labels: c.labels.map((cl) => ({ id: cl.label.id, name: cl.label.name, color: cl.label.color })),
    unread: c.unread,
    slaDueAt: c.slaDueAt ? c.slaDueAt.toISOString() : null,
    lastActivityAt: c.lastActivityAt.toISOString(),
    seq: c.seq,
    preview: c.preview,
  };
}

export function mapConversationWithMessages(c: ConversationFullRow): ConversationWithMessages {
  return {
    ...mapConversation(c),
    messages: [...c.messages].sort((a, b) => a.seq - b.seq).map(mapMessage),
  };
}
