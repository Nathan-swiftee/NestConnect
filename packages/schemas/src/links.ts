/**
 * Finding the links in a message someone typed, so they can be clicked.
 *
 * People don't type links the way a browser wants them. A customer writes
 * "swiftee.co.uk/track" or "www.ding.co.uk", not "https://…", and an agent
 * pastes an address mid-sentence with a full stop after it. All of those are
 * links to the person reading; none of them were, as plain text.
 *
 * What counts:
 *  - anything starting `http://` or `https://`;
 *  - anything starting `www.`;
 *  - a bare domain whose ending is a real, common one (`.co.uk`, `.com`,
 *    `.io`, …) — the list is what keeps "e.g." and "v1.2" and "file.txt" from
 *    turning blue;
 *  - an email address, which opens a new mail.
 *
 * What's left off the end: punctuation that ends the sentence rather than the
 * address ("see swiftee.co.uk." / "(at swiftee.co.uk)"), but a bracket the
 * address opened itself stays ("…/wiki/Thing_(band)").
 *
 * Only `https:`, `http:` and `mailto:` links are ever produced, so nothing a
 * customer types can become a script link.
 */
export interface TextPart {
  text: string;
  /** Where it goes, when this part is a link. */
  href?: string;
}

/** Endings a bare domain must have to be taken for one. Common and specific on
 *  purpose: a missed link is a nuisance, a false one is a blue word that goes
 *  nowhere. */
const TLDS = [
  "com", "co.uk", "org.uk", "uk", "org", "net", "io", "ai", "app", "dev", "co", "me", "info", "biz",
  "eu", "de", "fr", "es", "it", "nl", "ie", "us", "ca", "au", "il", "co.il", "in", "ly", "gl", "gg",
  "to", "tv", "so", "xyz", "shop", "store", "online", "site", "tech", "page", "link", "london", "nyc",
].sort((a, b) => b.length - a.length);

const tld = TLDS.map((t) => t.replace(/\./g, "\\.")).join("|");
const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const tail = "(?:[/?#][^\\s<>\"]*)?";

const LINK = new RegExp(
  [
    // An email address. First, so its domain isn't taken as a link on its own.
    `([a-z0-9._%+-]+@${label}(?:\\.${label})*\\.[a-z]{2,24})`,
    // A full address, or one starting www.
    `((?:https?:\\/\\/|www\\.)[^\\s<>"]+)`,
    // A bare domain with a known ending, and anything after it.
    `((?:${label}\\.)+(?:${tld})(?![a-z0-9-])(?::\\d{2,5})?${tail})`,
  ].join("|"),
  "gi",
);

/** Sentence punctuation that follows an address rather than belonging to it. */
function trimTrailing(raw: string): string {
  let url = raw.replace(/[.,;:!?'"’”*_~]+$/, "");
  // A closing bracket belongs to the address only if the address opened one.
  for (const [open, close] of [["(", ")"], ["[", "]"]] as const) {
    while (url.endsWith(close) && url.split(open).length < url.split(close).length) {
      url = url.slice(0, -1).replace(/[.,;:!?'"’”*_~]+$/, "");
    }
  }
  return url;
}

/**
 * Split text into plain runs and links, in order. Joining every part's `text`
 * gives back the original exactly.
 */
export function linkParts(text: string): TextPart[] {
  const out: TextPart[] = [];
  let at = 0;
  const push = (t: string, href?: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (!href && last && !last.href) last.text += t;
    else out.push(href ? { text: t, href } : { text: t });
  };
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    const before = text[start - 1];
    // Mid-word ("abc.co.uk" inside "xabc.co.uk" is impossible, but "@x.com"
    // after a handle, or "foo/bar.com" in a path, is not a fresh link).
    if (before && /[a-z0-9@/._-]/i.test(before)) continue;
    const [raw, email, full, bare] = m;
    const link = trimTrailing(raw);
    if (!link) continue;
    let href: string;
    if (email) {
      if (link !== raw) continue;
      href = `mailto:${link}`;
    } else if (full) {
      // Not "https://" on its own, nor "www." with no domain after it.
      if (!/^(?:https?:\/\/[^\s/]+|www\.[^\s.]+\.[a-z])/i.test(link)) continue;
      href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    } else if (bare) {
      href = `https://${link}`;
    } else {
      continue;
    }
    push(text.slice(at, start));
    push(link, href);
    at = start + link.length;
  }
  push(text.slice(at));
  return out.length ? out : [{ text }];
}
