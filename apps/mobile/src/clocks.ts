import { slaCountdown, timeUntil } from "@ding/client";
import type { Conversation } from "@ding/schemas";

/** Everything either clock reads. Structural, so both `Conversation` and
 *  `ConversationWithMessages` satisfy it without the caller casting. */
type Timed = Pick<Conversation, "status" | "slaDueAt" | "snoozedUntil">;

/**
 * The two things about a conversation that go stale by themselves.
 *
 * An SLA counts down to a deadline and a snooze counts down to a wake-up, and
 * both used to be drawn as a state rather than a time: the inbox row said
 * "· Snoozed", which is the one part you can already infer, and it drew the SLA
 * *only once breached* — so the countdown that decides what to pick up next was
 * invisible right up until it was too late to act on.
 *
 * The branches live here, once, rather than in the row and the thread header
 * separately. They differ in precision, not in meaning, and two copies of
 * "what counts as overdue" is how the list and the thread end up disagreeing
 * about the same conversation.
 *
 * `now` is passed in rather than read from the clock so both are pure — the
 * caller owns the tick (see `useNow`), and these are testable without one.
 */

/** Minute-grained, for a scrolling list. Strings and booleans only: they are
 *  props of a memoised row, and an object would be a fresh identity every tick.
 *  See the call site in the inbox. */
export function rowClocks(conv: Timed, now: number) {
  const due = slaDeadline(conv);
  const wake = snoozeWake(conv);
  return {
    slaText: due == null ? undefined : due <= now ? "Overdue" : timeUntil(conv.slaDueAt!, now),
    slaOver: due != null && due <= now,
    snoozeText:
      conv.status !== "snoozed"
        ? undefined
        : wake == null
          ? "Snoozed"
          : wake <= now
            ? "Due now"
            : timeUntil(conv.snoozedUntil!, now),
  };
}

/** Second-grained, for the one countdown in a thread header — where a single
 *  element can afford a 1s tick and the extra precision is worth reading. */
export function threadClocks(conv: Timed, now: number) {
  const due = slaDeadline(conv);
  const wake = snoozeWake(conv);
  const over = due != null && due <= now;
  return {
    slaText: due == null ? null : over ? "Overdue" : `${slaCountdown(conv.slaDueAt!, now)} left`,
    slaOver: over,
    /** Trailing separator included, so the caller concatenates rather than
     *  deciding whether a middot is needed. */
    statusText:
      conv.status === "snoozed"
        ? wake == null
          ? "Snoozed · "
          : wake <= now
            ? "Due now · "
            : `Back in ${timeUntil(conv.snoozedUntil!, now)} · `
        : conv.status === "closed"
          ? "Resolved · "
          : "",
  };
}

/**
 * When first response is due, or null if no deadline applies.
 *
 * Closed is the case worth naming: a resolved conversation keeps its `slaDueAt`
 * in the record, so reading the field alone would leave every closed thread
 * showing a countdown, or "Overdue" forever once the date passed. Nothing is
 * owed on a conversation that is finished.
 */
function slaDeadline(conv: Timed): number | null {
  if (!conv.slaDueAt || conv.status === "closed") return null;
  const t = new Date(conv.slaDueAt).getTime();
  return Number.isNaN(t) ? null : t;
}

/** When a snoozed conversation returns, or null when it isn't snoozed — or is,
 *  but without a wake time, which still counts as snoozed and is handled by the
 *  callers rather than silently dropped here. */
function snoozeWake(conv: Timed): number | null {
  if (conv.status !== "snoozed" || !conv.snoozedUntil) return null;
  const t = new Date(conv.snoozedUntil).getTime();
  return Number.isNaN(t) ? null : t;
}
