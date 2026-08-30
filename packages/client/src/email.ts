import type { Message } from "@ding/schemas";

/**
 * Who a reply goes to, worked out once for both apps.
 *
 * Reply and reply-all are the same send with a different Cc, so the only thing
 * either client actually needs from this is that list — and it has to be the
 * same list on a laptop and a phone, or the same button quietly copies a
 * different set of people depending on where an agent pressed it.
 */

/** Case-insensitive, order-preserving dedupe. */
function unique(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Pull a bare address out of a `Name <a@b.com>` header value. */
export function bareAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

/**
 * Everyone who should be copied when replying to all on this message.
 *
 * The customer themself is never in here: they are the To of the reply, which
 * the send path derives from the conversation. Neither are we — copying your
 * own shared inbox on your own reply is how a thread ends up ingesting itself,
 * and a support inbox that answers its own emails is a loop with a customer
 * watching.
 *
 * Everything else on the original goes in: the people the customer copied
 * (`email.cc`), and on a message we sent, everyone that copy went to
 * (`email.recipients`). Reply-all means the same people see the answer that saw
 * the question — a colleague dropped from the thread because we only kept the
 * sender is the failure this exists to avoid.
 */
export function replyAllRecipients(
  message: Pick<Message, "email"> | null | undefined,
  opts: { exclude?: (string | null | undefined)[] } = {},
): string[] {
  const meta = message?.email;
  if (!meta) return [];

  const excluded = new Set(
    (opts.exclude ?? [])
      .filter((a): a is string => !!a && a.trim().length > 0)
      .map(bareAddress),
  );

  const candidates = [...(meta.cc ?? []), ...(meta.recipients ?? []).map((r) => r.address)];

  return unique(
    candidates
      .map((a) => a.trim())
      .filter((a) => a.length > 0 && !excluded.has(bareAddress(a))),
  );
}

/**
 * Is reply-all a different act from reply on this message?
 *
 * Offering both when they do the same thing is a menu with a decoy in it. The
 * two only diverge when somebody other than us and the customer was on the
 * original, which is exactly when {@link replyAllRecipients} is non-empty.
 */
export function hasOtherRecipients(
  message: Pick<Message, "email"> | null | undefined,
  opts: { exclude?: (string | null | undefined)[] } = {},
): boolean {
  return replyAllRecipients(message, opts).length > 0;
}

/** Escape text for interpolation into forwarded-email HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The HTML body of a forwarded email: an optional note, the standard
 * "---------- Forwarded message ----------" header, then the original quoted.
 *
 * Shared because it is a *format* other mail clients parse and un-quote, not a
 * piece of one app's UI — and because it existed only inside the web's forward
 * modal, so the phone would have grown a second, subtly different version of
 * the same thing the moment it learned to forward.
 */
export function buildForwardedEmail(
  message: Pick<Message, "body" | "bodyHtml" | "direction" | "authorName" | "createdAt" | "email">,
  opts: { note?: string; fallbackSubject?: string | null; fromLabel?: string },
): string {
  const subject = message.email?.subject ?? opts.fallbackSubject ?? "";
  const who = message.direction === "out" ? message.authorName || "You" : message.authorName || opts.fromLabel || "";
  const when = new Date(message.createdAt).toLocaleString();
  const original = message.bodyHtml?.trim() || escapeHtml(message.body).replace(/\n/g, "<br>");
  const note = opts.note?.trim()
    ? `<p>${escapeHtml(opts.note.trim()).replace(/\n/g, "<br>")}</p>`
    : "";
  return (
    `${note}<p>---------- Forwarded message ----------<br>` +
    `From: ${escapeHtml(who)}<br>` +
    (subject ? `Subject: ${escapeHtml(subject)}<br>` : "") +
    `Date: ${escapeHtml(when)}</p><blockquote>${original}</blockquote>`
  );
}
