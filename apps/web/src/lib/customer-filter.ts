import type { ChannelType, Contact } from "@ding/schemas";

/**
 * Narrowing the customer directory.
 *
 * Pulled out of the component because the two combinators here are a real
 * decision rather than an implementation detail, and because a filter that
 * quietly returns nothing is the kind of bug people work around instead of
 * reporting — so it is worth being able to test.
 *
 * **Tags narrow (AND).** Picking "vip" and then "wholesale" means customers who
 * are both. Every added tag should cut the list down; a tag filter that widened
 * as you added to it would be the opposite of what the gesture looks like.
 *
 * **Channels widen (OR).** Picking WhatsApp and Email means reachable on
 * either. This is the opposite rule to tags on purpose: most customers have a
 * phone *or* an address, rarely both, so AND across channels would answer
 * almost every query with an empty table.
 */
export interface CustomerFilter {
  /** Free text, matched against name, company, number, address and tags. */
  query: string;
  /** Must have all of these. Empty means no tag filter. */
  tags: string[];
  /** Must be reachable on at least one of these. Empty means no channel filter. */
  channels: ChannelType[];
  showBlocked: boolean;
}

export const EMPTY_FILTER: CustomerFilter = { query: "", tags: [], channels: [], showBlocked: false };

/**
 * The channels a customer can actually be reached on.
 *
 * Derived from what we hold rather than stored, which is the same rule the
 * directory's Channels column already draws: a number means WhatsApp, an
 * address means email. `whatsapp_group` is deliberately absent — a group is a
 * conversation with a number behind it, not a property of a person.
 */
export function reachableChannels(c: Pick<Contact, "phone" | "email">): ChannelType[] {
  const out: ChannelType[] = [];
  if (c.phone) out.push("whatsapp");
  if (c.email) out.push("email");
  return out;
}

/**
 * Every tag in use, with how many customers carry it, commonest first.
 *
 * Folded case-insensitively, because filtering is: listing "VIP" and "vip" as
 * two entries and then having either of them match both customers is the kind
 * of inconsistency that reads as the filter being broken. The label shown is
 * whichever spelling is commonest, so a directory that mostly says "VIP" is not
 * relabelled by one import that wrote it in lower case.
 */
export function tagCounts(contacts: Contact[]): { tag: string; count: number }[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const c of contacts) {
    for (const t of c.tags ?? []) {
      const key = t.toLowerCase();
      const g = groups.get(key) ?? { count: 0, spellings: new Map() };
      g.count++;
      g.spellings.set(t, (g.spellings.get(t) ?? 0) + 1);
      groups.set(key, g);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const [label] = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { tag: label, count: g.count, key };
    })
    // Commonest first, then alphabetical — a stable order, so the menu doesn't
    // reshuffle under the cursor when a count changes.
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map(({ tag, count }) => ({ tag, count }));
}

/** Does this customer match the free-text part? Tags are searched too, so
 *  typing a tag name still works without opening the tag menu. */
function matchesQuery(c: Contact, needle: string): boolean {
  if (!needle) return true;
  return [c.displayName, c.company, c.phone, c.email, ...(c.tags ?? [])]
    .filter(Boolean)
    .some((v) => (v as string).toLowerCase().includes(needle));
}

export function filterCustomers(contacts: Contact[], f: CustomerFilter): Contact[] {
  const needle = f.query.trim().toLowerCase();
  // Tag comparison is case-insensitive: tags arrive from imports and from
  // hand-typing, so "VIP" and "vip" are the same label to everyone but a
  // strict equality check.
  const wanted = f.tags.map((t) => t.toLowerCase());

  return contacts.filter((c) => {
    if (!f.showBlocked && c.blocked) return false;
    if (!matchesQuery(c, needle)) return false;
    if (wanted.length) {
      const has = new Set((c.tags ?? []).map((t) => t.toLowerCase()));
      if (!wanted.every((t) => has.has(t))) return false;
    }
    if (f.channels.length) {
      const on = reachableChannels(c);
      if (!f.channels.some((ch) => on.includes(ch))) return false;
    }
    return true;
  });
}

/** Whether anything is narrowing the list — drives the "Clear" affordance. */
export function isFiltered(f: CustomerFilter): boolean {
  return Boolean(f.query.trim() || f.tags.length || f.channels.length);
}
