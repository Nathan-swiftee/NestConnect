import type { Prisma } from "@prisma/client";
import type {
  Attachment,
  ChannelType,
  Contact,
  Conversation,
  ConversationWithMessages,
  Inbox,
  Message,
  MessageStatus,
  MessageType,
  Participant,
  ParticipantRole,
  Priority,
  RoutingStrategy,
  Team,
  User,
} from "@ding/schemas";
import { isInboxConnected } from "@ding/schemas";

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
    messages: { include: { attachments: true } };
    participants: { include: { contact: { include: { identities: true } } } };
  };
}>;
type MessageRow = Prisma.MessageGetPayload<{ include: { attachments: true } }>;
type AttachmentRow = Prisma.AttachmentGetPayload<object>;

/** Same-origin URL the client uses to stream/download the file. */
export function mediaUrl(attachmentId: string): string {
  return `/api/media/${attachmentId}`;
}

/** A list preview for a media message that carries no text caption. */
export function previewForType(type?: MessageType): string {
  switch (type) {
    case "image": return "📷 Photo";
    case "video": return "🎥 Video";
    case "voice": return "🎤 Voice message";
    case "audio": return "🎵 Audio";
    case "document": return "📄 Document";
    case "sticker": return "Sticker";
    case "location": return "📍 Location";
    case "contact": return "👤 Contact";
    default: return "";
  }
}

export function mapAttachment(a: AttachmentRow): Attachment {
  let waveform: number[] | undefined;
  if (a.waveform) {
    try {
      const parsed = JSON.parse(a.waveform);
      if (Array.isArray(parsed)) waveform = parsed as number[];
    } catch {
      /* ignore malformed waveform */
    }
  }
  return {
    id: a.id,
    kind: a.kind as Attachment["kind"],
    mime: a.mime,
    size: a.size,
    filename: a.filename,
    url: mediaUrl(a.id),
    durationMs: a.durationMs ?? undefined,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    waveform,
  };
}
type ParticipantRow = Prisma.ParticipantGetPayload<{
  include: { contact: { include: { identities: true } } };
}>;

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
  return { id: t.id, orgId: t.orgId, name: t.name, icon: t.icon ?? null, order: t.order, slaMinutes: t.slaMinutes ?? null };
}

export function mapInbox(i: InboxWithTeams): Inbox {
  const type = i.type as ChannelType;
  return {
    id: i.id,
    orgId: i.orgId,
    type,
    name: i.name,
    handle: i.handle,
    teamIds: i.teams.map((t) => t.teamId),
    routingStrategy: i.routingStrategy as RoutingStrategy,
    unread: 0,
    connected: isInboxConnected(type, i.channelConfig as Record<string, string> | null),
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
    tags: c.tags ?? [],
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
    messageType: (m.messageType as MessageType) ?? "text",
    attachments: (m.attachments ?? []).map(mapAttachment),
    createdAt: m.createdAt.toISOString(),
  };
}

export function mapParticipant(p: ParticipantRow): Participant {
  return {
    id: p.id,
    conversationId: p.conversationId,
    contact: mapContact(p.contact),
    role: p.role as ParticipantRole,
    joinedAt: p.joinedAt.toISOString(),
  };
}

export function mapConversation(c: ConversationSummaryRow): Conversation {
  return {
    id: c.id,
    orgId: c.orgId,
    inboxId: c.inboxId,
    channel: c.channel as ChannelType,
    contact: mapContact(c.contact),
    subject: c.subject ?? undefined,
    inviteLink: c.inviteLink ?? undefined,
    channelRef: c.channelRef ?? undefined,
    status: c.status as Conversation["status"],
    assigneeUserId: c.assigneeUserId,
    assignedTeamId: c.assignedTeamId,
    priority: c.priority as Priority,
    labels: c.labels.map((cl) => ({ id: cl.label.id, name: cl.label.name, color: cl.label.color })),
    unread: c.unread,
    unreadCount: c.unreadCount ?? 0,
    slaDueAt: c.slaDueAt ? c.slaDueAt.toISOString() : null,
    snoozedUntil: c.snoozedUntil ? c.snoozedUntil.toISOString() : null,
    lastActivityAt: c.lastActivityAt.toISOString(),
    seq: c.seq,
    preview: c.preview,
  };
}

export function mapConversationWithMessages(c: ConversationFullRow): ConversationWithMessages {
  return {
    ...mapConversation(c),
    messages: [...c.messages].sort((a, b) => a.seq - b.seq).map(mapMessage),
    participants: c.participants.map(mapParticipant),
  };
}
