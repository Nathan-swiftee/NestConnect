/*
 * @-mentions in internal notes.
 *
 * A mention is stored as a handle, "@" plus the local part of the teammate's
 * email ("@nathan"). That handle is what the server matches to notify them and
 * to file the note in their Mentions inbox, so it stays the stored form.
 *
 * People don't think in handles, though. The composer puts "@Nathan A" in the
 * box, turns it into "@nathan" on the way out, and every place a note is shown
 * turns it back into the name. The handle only shows when it matches nobody.
 */

export interface Mentionable {
  name: string;
  email: string;
}

/** "@nathan" — the stored, routed form. */
export function mentionHandle(person: Pick<Mentionable, "email">): string {
  return "@" + person.email.split("@")[0]!.toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names more than one teammate share. A name like that can't say who is meant. */
function sharedNames(people: Mentionable[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of people) {
    const k = p.name.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * What the composer inserts for a teammate: "@Nathan A". When two teammates
 * share that name it falls back to the handle, which can't be mistaken.
 */
export function mentionLabel(person: Mentionable, people: Mentionable[]): string {
  const name = person.name.trim();
  return name && !sharedNames(people).has(name.toLowerCase()) ? `@${name}` : mentionHandle(person);
}

/**
 * "@Nathan A, can you…" → "@nathan, can you…" before a note is sent. Longest
 * names first, so "@Sam Lee" isn't read as "@Sam" followed by "Lee". A name
 * must end at a space, punctuation or the end of the text.
 */
export function namesToHandles(text: string, people: Mentionable[]): string {
  const shared = sharedNames(people);
  const byLength = [...people]
    .filter((p) => p.name.trim() && !shared.has(p.name.trim().toLowerCase()))
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  let out = text;
  for (const p of byLength) {
    const re = new RegExp(`(^|\\s)@${escapeRe(p.name.trim())}(?=$|[\\s.,!?;:)\\]'"’])`, "gi");
    out = out.replace(re, (_m, lead: string) => lead + mentionHandle(p));
  }
  return out;
}

/**
 * A stored note body as pieces to draw: plain text, and mentions shown by name
 * ("@Nathan A") when the handle matches a teammate, as written when it doesn't.
 */
export function mentionParts(body: string, people: Mentionable[]): Array<{ text: string; mention: boolean }> {
  const byHandle = new Map(people.map((p) => [mentionHandle(p), p.name.trim()]));
  return body
    .split(/(@[\w.+-]+)/g)
    .filter((part) => part !== "")
    .flatMap((part) => {
      if (!part.startsWith("@")) return [{ text: part, mention: false }];
      // "@nathan." at the end of a sentence: the full stop isn't part of it.
      const [, handle, tail] = /^(@[\w.+-]*?)([.+-]*)$/.exec(part)!;
      const name = byHandle.get(handle!.toLowerCase());
      if (!name) return [{ text: part, mention: true }];
      return tail ? [{ text: `@${name}`, mention: true }, { text: tail, mention: false }] : [{ text: `@${name}`, mention: true }];
    });
}

/** The same body as one plain string, for previews and notifications. */
export function mentionsToNames(body: string, people: Mentionable[]): string {
  return mentionParts(body, people)
    .map((p) => p.text)
    .join("");
}
