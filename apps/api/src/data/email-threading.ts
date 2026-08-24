import type { ChannelType } from "@ding/schemas";

/**
 * When a second inbound email belongs to the thread you already have.
 *
 * Email is the only channel here where a thread is a *topic* rather than a
 * person. On WhatsApp there is one conversation per number and every message
 * joins it; in a mailbox, "Invoice #4471" and "Christmas opening hours" from
 * the same customer are two different conversations, and filing the second onto
 * the first buries it.
 *
 * This is only ever the fallback. An actual reply carries `In-Reply-To` /
 * `References` pointing at a message already in the thread, and the ingest path
 * matches on those first — which is what makes an agent editing the subject
 * safe: the customer's reply threads on the header chain, not on the words.
 * (And it would match here anyway, since editing the subject writes it to the
 * conversation, so the customer's "Re: <new subject>" normalises to it.)
 *
 * Subjects are compared with their reply and forward prefixes stripped, because
 * "Invoice #4471", "Re: Invoice #4471" and "Fwd: Re: Invoice #4471" are one
 * conversation by any reading a person would give them.
 */

/**
 * One reply/forward prefix, with the numbering Outlook adds when a thread has
 * been round-tripped ("Re[2]:"). Non-English prefixes are included because a
 * customer's mail client localises them and the thread is the same thread.
 */
const PREFIX = /^\s*(?:re|fwd?|aw|antw|sv|vs|tr|rif|enc|odp|ynt)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*/i;

/**
 * A subject reduced to the part that identifies the thread: prefixes stripped,
 * whitespace collapsed, case folded.
 *
 * An absent subject normalises to the empty string, so the mail clients that
 * send no subject at all still thread together rather than opening a new
 * conversation per message.
 */
export function normalizeSubject(subject?: string | null): string {
  let s = (subject ?? "").replace(/\s+/g, " ").trim();
  // Strip every stacked prefix, not just the outermost — a thread that has been
  // forwarded and replied to arrives as "Fwd: Re: Re: …". Bounded because the
  // subject is attacker-supplied and a loop over it shouldn't be unbounded.
  for (let i = 0; i < 12; i++) {
    const next = s.replace(PREFIX, "");
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

/**
 * Whether an inbound message on `channel` with `subject` belongs to an existing
 * conversation carrying `existingSubject`.
 *
 * Non-email channels always match: they have no subject, and one conversation
 * per person is the whole point of them. Guarding on the channel rather than on
 * "does a subject exist" matters — a WhatsApp group conversation carries the
 * group's name in the subject field, and comparing that against an inbound with
 * no subject would fork every group thread on every message.
 */
export function threadsTogether(
  channel: ChannelType,
  subject: string | null | undefined,
  existingSubject: string | null | undefined,
): boolean {
  if (channel !== "email") return true;
  return normalizeSubject(subject) === normalizeSubject(existingSubject);
}
