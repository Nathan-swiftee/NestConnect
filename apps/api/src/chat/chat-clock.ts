let last = 0;

/**
 * Now, as an ISO string — but never the same instant twice.
 *
 * Ticks and unread counts compare a message's time with "read up to here", so
 * two messages sent in the same millisecond, or a message landing in the same
 * millisecond someone read the chat, would be ambiguous. One step past the last
 * stamp keeps every one of them strictly ordered.
 */
export function chatClock(): string {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return new Date(last).toISOString();
}
