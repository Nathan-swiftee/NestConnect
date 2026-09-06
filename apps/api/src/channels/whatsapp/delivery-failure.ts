/**
 * Why a WhatsApp message that we sent successfully never arrived.
 *
 * There are two quite different failures behind one word. A *send* failure is
 * the Graph API rejecting the request — `shortReason` in the dispatcher writes
 * those. A *delivery* failure is Meta accepting the message, giving us a wamid,
 * and then telling us over the webhook that it gave up. This handles the second
 * kind, which until now we logged and threw away: the message flipped to
 * "failed" and the thread said "Not delivered", while the actual answer —
 * often something an admin can fix in a minute — sat in the server log.
 *
 * The rule is to prefer Meta's own words. Its `title` and `details` are written
 * for this exact situation and are accurate by definition; a lookup table of
 * half-remembered codes would go stale the first time Meta added one. Only two
 * codes are worded here, and only because they are the two an agent can act on
 * without leaving the conversation.
 */

/** The error object Meta puts on a `failed` status. */
export interface DeliveryError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
}

/**
 * The banner is one line under a message, not a support article.
 *
 * Long enough for Meta's longest useful sentence, short enough that it cannot
 * push the conversation off the screen.
 */
const MAX = 220;

/**
 * The two failures an agent can do something about themselves.
 *
 * Everything else — billing, policy, media, rate limits — is Meta's own
 * sentence, because it is more accurate than anything written from memory here
 * and it stays right when Meta changes it.
 */
const AGENT_ACTIONABLE: Record<number, string> = {
  // The 24-hour service window has closed, so a free-form reply cannot be sent.
  131047: "The 24-hour reply window has closed — send an approved template to reopen the conversation.",
  // The number is not on WhatsApp, or cannot receive from this business.
  131026: "This number can't receive WhatsApp messages — check it's the right number and is on WhatsApp.",
};

/**
 * Strip URLs out of Meta's prose.
 *
 * Meta likes to append "Visit https://business.facebook.com/billing_hub/…
 * &wizard_name=CHANGE_COUNTRY_CURRENCY… to resolve this issue" — a 200-character
 * link that would be most of the banner and is not something anyone types off a
 * screen anyway. The sentence before it says what is wrong, which is what the
 * person reading a conversation needs; the full text with the link is still in
 * the log for whoever is actually going to fix it.
 */
function stripUrls(text: string): string {
  return (
    text
      // The whole sentence, not just the link. Taking out the URL alone leaves
      // "…currency is not configured. to resolve this issue." — which reads
      // like a bug in our software rather than a message from Meta.
      .replace(/\bVisit\s+https?:\/\/\S+[^.]*\.?/gi, "")
      // Any other bare link: no sentence to take with it.
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** Cut at a word boundary rather than mid-word, and say that it was cut. */
function clamp(text: string, max = MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:—-]$/, "") + "…";
}

/**
 * One sentence for the thread, from Meta's error on a failed status.
 *
 * Returns undefined when there is nothing worth saying — the caller then leaves
 * `failureReason` unset and the UI falls back to its own "Not delivered", which
 * is better than a banner reading "WhatsApp: error 0".
 */
export function deliveryFailureReason(error: DeliveryError | undefined): string | undefined {
  if (!error) return undefined;

  const own = error.code !== undefined ? AGENT_ACTIONABLE[error.code] : undefined;
  if (own) return own;

  const details = stripUrls(error.error_data?.details ?? "");
  const title = (error.title ?? "").trim();
  const message = stripUrls(error.message ?? "");

  // Title and details together read as "what went wrong — why", which is how
  // Meta means them. Either alone is still useful; `message` is the fallback
  // for the older shape that has no title.
  const body = details || message;
  if (title && body) {
    // Meta sometimes repeats the title inside details. Saying it twice in one
    // line looks like a bug in our code, not a quirk of theirs.
    const combined = body.toLowerCase().includes(title.toLowerCase()) ? body : `${title} — ${body}`;
    return clamp(`WhatsApp: ${combined}`);
  }
  if (title || body) return clamp(`WhatsApp: ${title || body}`);
  if (error.code !== undefined) return `WhatsApp couldn't deliver this message (error ${error.code}).`;
  return undefined;
}
