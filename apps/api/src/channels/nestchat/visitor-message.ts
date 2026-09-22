import type { Message, NestChatMessage, NestChatQuote } from "@ding/schemas";
import { NESTCHAT_QUOTE_PREVIEW_MAX } from "@ding/schemas";

/**
 * A stored message, as the visitor is allowed to see it.
 *
 * A free function rather than a method because two very different callers need
 * it: the service that answers the widget's own requests, and the outbound
 * provider that nudges an open widget when an agent does something. Making the
 * provider reach the service for this would be a dependency cycle to serve a
 * mapping that reads its arguments and nothing else.
 *
 * Returns nothing for anything the visitor was never meant to see — an
 * internal note, a system line — so a caller that forwards whatever it gets
 * back cannot leak one by forgetting to check.
 */
export function toVisitorMessage(message: Message, thread?: Message[]): NestChatMessage | undefined {
  if (message.internal || message.authorType === "system") return undefined;
  const quote = quoteFor(message, thread);
  return {
    id: message.id,
    from: message.direction === "in" ? "visitor" : "agent",
    authorName: message.direction === "out" ? message.authorName || undefined : undefined,
    body: message.body,
    at: message.createdAt,
    attachments: message.attachments?.length
      ? message.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime: a.mime,
          kind: a.kind,
          // Only ever set on a voice note, and only because the recorder
          // measured them while it was being made. A file somebody attached
          // has neither.
          ...(a.durationMs === undefined ? {} : { durationMs: a.durationMs }),
          ...(a.waveform?.length ? { waveform: a.waveform } : {}),
        }))
      : undefined,
    // `by` is rewritten to the reader's point of view. The stored value says
    // which side of the desk put it there; a visitor's widget needs to know
    // which one is *theirs*, and those are the same fact named differently.
    reactions: (message.reactions ?? []).map((r) => ({
      emoji: r.emoji,
      by: r.by === "contact" ? ("visitor" as const) : ("agent" as const),
    })),
    ...(quote ? { quote } : {}),
  };
}

/**
 * The message a reply is answering, as much of it as a quote needs.
 *
 * Returns nothing when the original is not in the thread we were handed, which
 * covers both the innocent case (a window that starts after it) and the
 * hostile one (an id from somebody else's conversation). A quote is a copy of
 * somebody's words rendered inside a reply, so "not found" is the only safe
 * answer to "quote this id I made up".
 *
 * An internal note is never quotable, for the stronger reason: it sits in the
 * same thread, the visitor has never seen it, and a reply quoting one would be
 * the first time they did.
 */
export function quoteFor(message: Message, thread?: Message[]): NestChatQuote | undefined {
  if (!message.quotedMsgId || !thread) return undefined;
  const original = thread.find((m) => m.id === message.quotedMsgId);
  if (!original || original.internal || original.authorType === "system") return undefined;

  const words = original.body.trim().replace(/\s+/g, " ");
  // A voice note has no words to show, and "" under a reply reads as a broken
  // quote rather than as a recording. The kind is what the bubble draws
  // instead — a little waveform, a paperclip — so it travels even when there
  // is text as well.
  const kind = original.attachments?.[0]?.kind;
  return {
    id: original.id,
    from: original.direction === "in" ? "visitor" : "agent",
    ...(original.direction === "out" && original.authorName
      ? { authorName: original.authorName }
      : {}),
    preview:
      words.length > NESTCHAT_QUOTE_PREVIEW_MAX
        ? `${words.slice(0, NESTCHAT_QUOTE_PREVIEW_MAX - 1)}…`
        : words,
    ...(kind ? { kind } : {}),
  };
}
