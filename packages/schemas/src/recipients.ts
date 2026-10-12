/*
 * Email recipients typed into Forward and Cc/Bcc.
 *
 * The field suggests customers already in the directory as you type, and still
 * takes any address you type yourself — most forwards go to somebody new.
 * Teammates aren't suggested on purpose: for them there's the internal note.
 */

/** Loose on purpose: something@something.tld, no spaces. The provider has the final say. */
export function isEmailAddress(s: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s.trim());
}

/**
 * Addresses out of pasted or typed text: "a@x.com, b@y.com" or
 * "Marta <marta@x.com>; b@y.com". Lower-cased, de-duplicated, order kept.
 */
export function parseAddressList(text: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const addr = raw.trim().replace(/^mailto:/i, "").toLowerCase();
    if (addr && !out.includes(addr)) out.push(addr);
  };
  for (const part of text.split(/[,;]+/)) {
    // "Marta Kowalska <marta@x.com>": the name is a label, not a recipient.
    const angled = /<([^>]+)>/.exec(part);
    if (angled) push(angled[1]!);
    else for (const word of part.split(/\s+/)) push(word);
  }
  return out;
}

export interface RecipientContact {
  id: string;
  displayName: string;
  email?: string | null;
  company?: string | null;
  blocked?: boolean;
}

/**
 * Customers to suggest for what's typed: ones with an email address, not
 * blocked, not already in the field. Name and address prefixes first, then
 * anything containing it (company too). Empty query suggests nothing — the
 * field shouldn't open a list of the whole directory on focus.
 */
export function recipientSuggestions<T extends RecipientContact>(
  contacts: T[],
  query: string,
  exclude: string[] = [],
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(exclude.map((e) => e.toLowerCase()));
  const rank = (c: T): number => {
    const name = c.displayName.toLowerCase();
    const email = (c.email ?? "").toLowerCase();
    const company = (c.company ?? "").toLowerCase();
    if (email.startsWith(q) || name.startsWith(q)) return 0;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (email.includes(q) || name.includes(q) || company.includes(q)) return 2;
    return 9;
  };
  return contacts
    .filter((c) => c.email && !c.blocked && !taken.has(c.email.toLowerCase()))
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.c.displayName.localeCompare(b.c.displayName))
    .slice(0, limit)
    .map((x) => x.c);
}
