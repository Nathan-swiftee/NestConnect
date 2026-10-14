/**
 * Who an inbound email is really from, as far as replying goes.
 *
 * Mail can say "answer someone else": a `Reply-To` header. The usual case is a
 * website form, sent From `noreply@site` with Reply-To set to the visitor who
 * filled it in. It also covers a person writing from one address who wants
 * answers at another, and a booking or ticketing system relaying a customer's
 * message. Every mail client sends the reply to the Reply-To. So does a
 * shared inbox, and it goes further: the Reply-To address is the customer.
 * Filing it under the From would put every form submission into one
 * conversation with "noreply", answered nowhere.
 *
 * So when Reply-To names someone other than the sender (and other than us),
 * the contact is that address and the reply goes there. The From is kept on
 * the message as where it came "via", so nobody wonders why the address
 * doesn't match the email they're reading.
 */
export interface EmailParty {
  email: string;
  name?: string;
}

export interface Correspondent {
  /** The address replies go to, and the customer's identity. */
  email: string;
  /** What to call them. */
  name: string;
  /** The address it actually came from, when that isn't `email`. */
  via?: string;
}

/**
 * Mailboxes that send on someone's behalf and never read what comes back. Their
 * display name ("Website", "WordPress") says nothing about who wrote in, so it
 * isn't borrowed for the person in the Reply-To.
 */
const AUTOMATED_SENDER =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer(-daemon)?|bounces?|postmaster|notifications?|notify|alerts?|system|forms?|formsubmit|submissions?|website|web|webmaster|wordpress|wix|squarespace|webflow|typeform|jotform|hubspot)([-+._].*)?@/i;

export function isAutomatedSender(address: string): boolean {
  return AUTOMATED_SENDER.test(address.trim());
}

const looksLikeAddress = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

/**
 * The person to file the email under and reply to.
 *
 * @param own every address of ours (the inbox's), never taken as the customer —
 *            a Reply-To pointing back at us is how a misconfigured relay looks.
 */
export function correspondent(from: EmailParty, replyTo: EmailParty | undefined, own: string[]): Correspondent {
  const sender = from.email.trim().toLowerCase();
  const ours = new Set(own.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const asked = replyTo?.email.trim().toLowerCase() ?? "";
  if (!asked || asked === sender || ours.has(asked) || !looksLikeAddress(asked)) {
    return { email: sender, name: from.name?.trim() || sender };
  }
  const name = replyTo?.name?.trim() || (isAutomatedSender(sender) ? undefined : from.name?.trim()) || asked;
  return { email: asked, name, via: sender };
}

/**
 * The first address in a Reply-To header, with its display name. A header may
 * list several; replying goes to all of them in a mail client, but a contact
 * is one person, so the first one is the customer.
 */
export function firstParty(raw: string | undefined): EmailParty | undefined {
  if (!raw?.trim()) return undefined;
  // The first entry: up to a comma that isn't inside quotes or <…>.
  let quoted = false;
  let angled = false;
  let end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angled = true;
    else if (ch === ">") angled = false;
    else if (ch === "," && !quoted && !angled) {
      end = i;
      break;
    }
  }
  const part = raw.slice(0, end).trim();
  const angle = part.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"|"$/g, "").trim();
    return { email: angle[2].trim().toLowerCase(), ...(name ? { name } : {}) };
  }
  return part ? { email: part.toLowerCase() } : undefined;
}
