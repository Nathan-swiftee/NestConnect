import { chatAttachmentLabel, chatSharedLabel, chatSystemText, mentionsToNames, type ChatMessage, type Mentionable } from "@ding/schemas";
import { clockTime } from "./format";

/*
 * How Team Chat reads: the day lines between messages, the times in the list,
 * "last seen", the previews — written once here so the web and the phone say
 * the same thing the same way.
 */

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (iso: string, now: Date) => Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The centred line between days: "Today", "Yesterday", "Monday", "3 Sep", "3 Sep 2025". */
export function chatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const ago = daysAgo(iso, now);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago < 7) return WEEKDAYS[d.getDay()]!;
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** The time on a row in the list of chats: "14:05", "Yesterday", "Mon", "03/09/25". */
export function chatListTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const ago = daysAgo(iso, now);
  if (ago <= 0) return clockTime(iso);
  if (ago === 1) return "Yesterday";
  if (ago < 7) return WEEKDAYS[d.getDay()]!.slice(0, 3);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${String(d.getFullYear()).slice(2)}`;
}

/** Under a person's name: "online", "last seen today at 14:05", "last seen 3 Sep". */
export function chatLastSeen(p: { online: boolean; lastSeenAt: string | null } | null | undefined, now = new Date()): string {
  if (!p) return "";
  if (p.online) return "online";
  if (!p.lastSeenAt) return "";
  const ago = daysAgo(p.lastSeenAt, now);
  if (ago <= 0) return `last seen today at ${clockTime(p.lastSeenAt)}`;
  if (ago === 1) return `last seen yesterday at ${clockTime(p.lastSeenAt)}`;
  return `last seen ${chatDayLabel(p.lastSeenAt, now)}`;
}

/** The one line under a chat in the list. */
export function chatPreview(
  m: ChatMessage | null | undefined,
  opts: { meId: string | null | undefined; group: boolean; people: Mentionable[] },
): string {
  if (!m) return "";
  if (m.kind === "system" && m.system) return chatSystemText(m.system);
  const who = m.author?.id && m.author.id === opts.meId ? "You" : opts.group ? (m.author?.name.split(" ")[0] ?? "") : "";
  const words = mentionsToNames(m.body, opts.people).replace(/\s+/g, " ").trim();
  const files = m.attachments?.length ? chatAttachmentLabel(m.attachments) : m.shared ? chatSharedLabel(m.shared) : "";
  // "📷 Photo" on its own; with a caption, the icon and the caption — as WhatsApp does.
  const text = m.deletedAt ? "This message was deleted" : files && words ? `${files.split(" ")[0]} ${words}` : files || words;
  return who ? `${who}: ${text}` : text;
}

/** Messages close enough together from the same person share a run: one name, one tail. */
const RUN_GAP_MS = 5 * 60_000;

export type ChatItem<M extends ChatMessage = ChatMessage> =
  | { kind: "day"; key: string; label: string }
  | { kind: "unread"; key: string; count: number }
  | { kind: "message"; key: string; message: M; first: boolean; last: boolean };

/**
 * The thread as rows to draw: a day line wherever the date changes, an
 * "unread messages" line before the first one I haven't read, and each message
 * knowing whether it starts or ends a run (so only the first shows a name and
 * only the last has a tail).
 */
export function chatItems<M extends ChatMessage>(
  messages: M[],
  opts: { meId: string | null | undefined; unreadAfter?: string | null; now?: Date } = { meId: null },
): ChatItem<M>[] {
  const out: ChatItem<M>[] = [];
  const now = opts.now ?? new Date();
  let lastDay = "";
  let unreadShown = !opts.unreadAfter;
  const unreadCount = opts.unreadAfter
    ? messages.filter((m) => m.kind === "text" && m.createdAt > opts.unreadAfter! && m.author?.id !== opts.meId).length
    : 0;
  messages.forEach((m, i) => {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      out.push({ kind: "day", key: `day-${m.id}`, label: chatDayLabel(m.createdAt, now) });
      lastDay = day;
    }
    if (!unreadShown && m.createdAt > opts.unreadAfter! && m.author?.id !== opts.meId && m.kind === "text") {
      if (unreadCount) out.push({ kind: "unread", key: `unread-${m.id}`, count: unreadCount });
      unreadShown = true;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const joins = (a: M | undefined, b: M | undefined) =>
      !!a &&
      !!b &&
      a.kind === "text" &&
      b.kind === "text" &&
      a.author?.id === b.author?.id &&
      new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString() &&
      Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < RUN_GAP_MS;
    out.push({ kind: "message", key: m.id, message: m, first: !joins(prev, m), last: !joins(m, next) });
  });
  return out;
}

/** The colour a person's name takes in a group, the same every time. */
const NAME_COLOURS = ["#1F7AEC", "#D9480F", "#0B8A5A", "#9C36B5", "#C2255C", "#5F3DC4", "#087F8C", "#E67700", "#2B8A3E", "#C92A2A"];
export function chatNameColour(userId: string | null | undefined): string {
  if (!userId) return NAME_COLOURS[0]!;
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return NAME_COLOURS[h % NAME_COLOURS.length]!;
}

/** Whether a message is only emoji (and short) — WhatsApp shows those big, without a bubble. */
export function isJumboEmoji(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 16) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/[0-9#*]/.test(t);
}
