import type { Prisma } from "@prisma/client";
import type {
  Attachment,
  ChannelType,
  Contact,
  Conversation,
  Inbox,
  Message,
  MessageStatus,
  MessageType,
  Notification,
  Participant,
  ParticipantRole,
  Priority,
  RoutingStrategy,
  Team,
  Template,
  TemplateApproval,
  TemplateCategory,
  User,
  WaWindow,
} from "@ding/schemas";
import { isInboxConnected } from "@ding/schemas";

/** WhatsApp's customer-service window is 24 hours from the last inbound message. */
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Whether a channel is one of the WhatsApp channels (1:1 or group). */
export function isWaChannel(channel: string | null | undefined): boolean {
  return channel === "whatsapp" || channel === "whatsapp_group";
}

/**
 * Compute the WhatsApp 24-hour window for a conversation. Only WhatsApp channels
 * have a window; everything else returns null. With no inbound yet the window is
 * closed (you must open with a template).
 */
export function computeWaWindow(
  channel: string,
  lastInboundAt: Date | string | null | undefined,
): WaWindow | null {
  if (channel !== "whatsapp" && channel !== "whatsapp_group") return null;
  if (!lastInboundAt) return { open: false, expiresAt: null };
  const last = typeof lastInboundAt === "string" ? new Date(lastInboundAt) : lastInboundAt;
  const expiresAt = new Date(last.getTime() + WA_WINDOW_MS);
  return { open: Date.now() < expiresAt.getTime(), expiresAt: expiresAt.toISOString() };
}

/** The delivery ladder order: queued → sending → sent → delivered → read. */
const STATUS_ORDER: MessageStatus[] = ["queued", "sending", "sent", "delivered", "read"];

/**
 * Whether a message may move from `current` to `next`. Status only ever advances
 * up the ladder (so a late/duplicate/out-of-order webhook can't drag a "read"
 * back to "sent"); "failed" is terminal and only reachable before delivery.
 */
export function canAdvanceStatus(current: MessageStatus, next: MessageStatus): boolean {
  if (current === next) return false;
  if (current === "failed") return false;
  if (next === "failed") return STATUS_ORDER.indexOf(current) < STATUS_ORDER.indexOf("delivered");
  return STATUS_ORDER.indexOf(next) > STATUS_ORDER.indexOf(current);
}

/** Count the distinct {{n}} positional variables in a template body. */
export function templateVariableCount(body: string): number {
  const nums = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return nums.size;
}

/** Prisma Template row → domain Template (variable count derived from the body). */
export function mapTemplate(t: Prisma.TemplateGetPayload<object>): Template {
  return {
    id: t.id,
    name: t.name,
    category: t.category as TemplateCategory,
    language: t.language,
    body: t.body,
    approvalStatus: t.approvalStatus as TemplateApproval,
    variableCount: templateVariableCount(t.body),
  };
}

/* Prisma row → domain type mappers. Includes are typed via Prisma payload helpers. */

type ContactWithIdentities = Prisma.ContactGetPayload<{ include: { identities: true } }>;
type InboxWithTeams = Prisma.InboxGetPayload<{ include: { teams: true } }>;
type ConversationSummaryRow = Prisma.ConversationGetPayload<{
  include: {
    contact: { include: { identities: true } };
    labels: { include: { label: true } };
    assignee: { select: { name: true } };
    messages: true;
  };
}>;
type MessageRow = Prisma.MessageGetPayload<{ include: { attachments: true } }>;
type AttachmentRow = Prisma.AttachmentGetPayload<object>;

/** Same-origin URL the client uses to stream/download the file. */
export function mediaUrl(attachmentId: string): string {
  return `/api/media/${attachmentId}`;
}

/** The message type implied by an attachment's kind (for outbound media). */
export function messageTypeForKind(kind: string): MessageType {
  switch (kind) {
    case "image":
    case "video":
    case "audio":
    case "voice":
    case "sticker":
      return kind;
    default:
      return "document";
  }
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
    available: u.available,
    emailSignature: u.emailSignature ?? undefined,
  };
}

export function mapNotification(n: Prisma.NotificationGetPayload<object>): Notification {
  return {
    id: n.id,
    type: n.type as Notification["type"],
    title: n.title,
    body: n.body,
    conversationId: n.conversationId ?? undefined,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
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

/** Parse the stored reactions JSON into a clean [{emoji, by}] array. */
export function parseReactions(raw: unknown): Message["reactions"] {
  if (!Array.isArray(raw)) return [];
  const out: Message["reactions"] = [];
  for (const r of raw) {
    if (r && typeof r === "object" && typeof (r as { emoji?: unknown }).emoji === "string") {
      const by = (r as { by?: unknown }).by;
      out.push({ emoji: (r as { emoji: string }).emoji, by: by === "user" ? "user" : "contact" });
    }
  }
  return out;
}

export function mapMessage(m: MessageRow): Message {
  const dm = m.deliveryMeta as { subject?: string; cc?: string[]; bcc?: string[] } | null;
  const email =
    dm && (dm.subject || dm.cc?.length || dm.bcc?.length)
      ? { subject: dm.subject, cc: dm.cc, bcc: dm.bcc }
      : undefined;
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
    channel: (m.channel as ChannelType | null) ?? undefined,
    messageType: (m.messageType as MessageType) ?? "text",
    attachments: (m.attachments ?? []).map(mapAttachment),
    reactions: parseReactions(m.reactions),
    quotedMsgId: m.quotedMsgId ?? undefined,
    bodyHtml: m.bodyHtml ?? undefined,
    attemptCount: m.attemptCount ?? 0,
    failureReason: m.failureReason ?? undefined,
    email,
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
    assigneeName: c.assignee?.name ?? null,
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
    // Channel of the latest customer-facing message (falls back to the origin).
    lastChannel: ((c.messages?.[0]?.channel as ChannelType | null | undefined) ?? (c.channel as ChannelType)),
    waWindow: computeWaWindow(c.channel, c.lastInboundAt),
  };
}

