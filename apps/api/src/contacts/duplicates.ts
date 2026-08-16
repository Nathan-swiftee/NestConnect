import type { Contact, ContactDuplicateGroup, ContactDuplicateReason } from "@ding/schemas";
import { normalizeIdentity } from "./identity";

/**
 * Group contacts that probably represent the same customer.
 *
 * Two contacts collide when they share a canonicalised identifier — the same
 * E.164 phone or the same lower-cased email. Collisions are transitive (A shares
 * a phone with B, B shares an email with C ⇒ A, B and C are one group), so we
 * union-find over the shared keys and return each connected component of two or
 * more contacts, tagged with the identifiers that tied it together.
 *
 * Pure and store-agnostic: both the Postgres and in-memory stores feed it the
 * org's contacts and return the result unchanged.
 */
export function groupDuplicateContacts(contacts: Contact[]): ContactDuplicateGroup[] {
  // Canonical key for a contact's phone/email, e.g. "phone:+447911123456".
  const keyOf = (kind: "phone" | "email", raw: string): string | null => {
    const norm = normalizeIdentity(kind, raw)?.normalized;
    return norm ? `${kind}:${norm}` : null;
  };

  const keysByContact = new Map<string, string[]>();
  const contactsByKey = new Map<string, string[]>();
  const byId = new Map<string, Contact>();

  for (const c of contacts) {
    byId.set(c.id, c);
    const keys: string[] = [];
    const pk = c.phone ? keyOf("phone", c.phone) : null;
    const ek = c.email ? keyOf("email", c.email) : null;
    if (pk) keys.push(pk);
    if (ek) keys.push(ek);
    keysByContact.set(c.id, keys);
    for (const k of keys) {
      const list = contactsByKey.get(k);
      if (list) list.push(c.id);
      else contactsByKey.set(k, [c.id]);
    }
  }

  // Union-find over contact ids.
  const parent = new Map<string, string>();
  for (const c of contacts) parent.set(c.id, c.id);
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path-compress so repeated lookups stay near-constant.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const ids of contactsByKey.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Collect components.
  const members = new Map<string, string[]>();
  for (const c of contacts) {
    const root = find(c.id);
    const list = members.get(root);
    if (list) list.push(c.id);
    else members.set(root, [c.id]);
  }

  const groups: ContactDuplicateGroup[] = [];
  for (const ids of members.values()) {
    if (ids.length < 2) continue;
    const memberSet = new Set(ids);
    // Reasons: keys shared by two or more members of this component.
    const reasons: ContactDuplicateReason[] = [];
    for (const [key, holders] of contactsByKey) {
      if (holders.filter((id) => memberSet.has(id)).length < 2) continue;
      const sep = key.indexOf(":");
      reasons.push({ kind: key.slice(0, sep) as "phone" | "email", value: key.slice(sep + 1) });
    }
    groups.push({ contacts: ids.map((id) => byId.get(id)!), reasons });
  }

  // Biggest, most-tangled clusters first.
  groups.sort((a, b) => b.contacts.length - a.contacts.length || b.reasons.length - a.reasons.length);
  return groups;
}
