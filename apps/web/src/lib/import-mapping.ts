/**
 * Working out which column is which.
 *
 * Nobody exports a customer list in our field names. They arrive as "Client",
 * "Contact Name", "Mobile No.", "E-mail Address", "Organisation" — and from a
 * dozen CRMs that each picked different words. Asking someone to map six columns
 * by hand before they can import anything is the step where imports get
 * abandoned, so this guesses, shows the guess, and lets it be corrected.
 *
 * Scored rather than first-match, and that distinction is the whole design.
 * "Company Name" contains "name", so any rule that scans for a substring and
 * takes the first hit maps it to the customer's *name* and quietly imports a
 * list where every customer is called after their employer. Specific labels
 * therefore have to outrank generic ones, which means scoring every candidate
 * and taking the best — not stopping early.
 */
import type { CreateContactInput } from "@ding/schemas";

/** The fields an import can fill. `firstName`/`lastName` are not stored — they
 *  are combined into `displayName`, because plenty of exports split the name. */
export type ImportField = "displayName" | "firstName" | "lastName" | "company" | "phone" | "email" | "tags";

/** Column index per field; absent means no column matched. */
export type ColumnMap = Partial<Record<ImportField, number>>;

/**
 * Header spellings, most specific first.
 *
 * A header scores by the *longest* pattern it matches, so "company name" (13)
 * beats "name" (4) and lands on `company`. Within a field, an exact match beats
 * a contained one, so a column literally called "Name" wins `displayName`
 * outright even in a file that also has "Customer Name".
 */
const PATTERNS: Record<ImportField, string[]> = {
  // Deliberately does not include a bare "name": that is handled as an exact
  // match below, so "company name" and "first name" can claim it first.
  displayName: [
    "display name", "customer name", "contact name", "client name", "full name",
    "customer", "contact", "client", "person", "name",
  ],
  firstName: ["first name", "firstname", "given name", "forename", "first"],
  lastName: ["last name", "lastname", "surname", "family name", "last"],
  company: [
    "company name", "organisation name", "organization name", "business name",
    "account name", "company", "organisation", "organization", "business",
    "account", "employer", "firm",
  ],
  phone: [
    "mobile number", "phone number", "contact number", "telephone number",
    "whatsapp number", "mobile phone", "cell phone",
    "whatsapp", "telephone", "mobile", "phone", "cell", "msisdn", "tel",
  ],
  email: ["email address", "e-mail address", "email", "e-mail", "mail"],
  tags: ["tags", "tag", "labels", "label", "segments", "segment", "categories", "category"],
};

/** Lower-case, collapse punctuation and runs of space: `"E-Mail_Address "` and
 *  `"e mail address"` are the same header written by two different systems. */
function normalise(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well one header fits one field. Higher is better; 0 is no fit.
 *
 * An exact match scores far above any containment, so a column called exactly
 * "Phone" always beats a longer "Phone Number" match found inside some other
 * header. Below that, longer patterns win — which is what keeps "company name"
 * away from `displayName`.
 */
function score(header: string, field: ImportField): number {
  const h = normalise(header);
  if (!h) return 0;
  let best = 0;
  for (const p of PATTERNS[field]) {
    if (h === p) best = Math.max(best, 1000 + p.length);
    else if (h.includes(p)) best = Math.max(best, p.length);
  }
  return best;
}

/**
 * Match every header to at most one field, and every field to at most one
 * column.
 *
 * Resolved globally rather than per column: the best (header, field) pair in
 * the whole file is settled first, then both are taken out of the running, and
 * so on. Deciding column-by-column would let an early "Name" column take
 * `displayName` before the file's actual "Customer Name" column was considered.
 */
export function matchColumns(headers: string[]): ColumnMap {
  const fields: ImportField[] = ["displayName", "firstName", "lastName", "company", "phone", "email", "tags"];
  const candidates: { index: number; field: ImportField; score: number }[] = [];
  headers.forEach((h, index) => {
    for (const field of fields) {
      const s = score(h, field);
      if (s > 0) candidates.push({ index, field, score: s });
    }
  });
  // Ties broken by column order, so a mapping is stable rather than depending
  // on object key order.
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);

  const map: ColumnMap = {};
  const usedColumns = new Set<number>();
  for (const c of candidates) {
    if (map[c.field] !== undefined || usedColumns.has(c.index)) continue;
    map[c.field] = c.index;
    usedColumns.add(c.index);
  }

  // A split name wins over a whole one: a file with "First Name", "Last Name"
  // *and* "Name" is usually one where "Name" is something else entirely, and
  // joining the two halves loses nothing either way.
  if (map.firstName !== undefined && map.displayName !== undefined && map.lastName !== undefined) {
    delete map.displayName;
  }
  return map;
}

/** One parsed row, ready to import — or the reason it can't be. */
export interface ImportRow {
  /** 1-based row number in the file, header excluded — what a spreadsheet shows. */
  line: number;
  contact: CreateContactInput | null;
  /** Why this row is being skipped, when it is. */
  problem?: string;
}

/** Split a tags cell. Accepts the three separators people actually use. */
export function splitTags(cell: string): string[] {
  return cell
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Turn parsed rows into contacts, using the column map.
 *
 * A row needs a name and at least one way to reach the customer. Both rules
 * exist because the alternative is worse than skipping: a contact with no name
 * shows up in the directory as an empty row, and one with no phone or email can
 * never be messaged, so it is a record that can only ever be deleted.
 *
 * Falls back to the email's local part when there is no name column at all —
 * an export of nothing but addresses is a real thing to be handed, and
 * "j.smith" is a better directory entry than a blank.
 */
export function rowsToContacts(
  rows: string[][],
  map: ColumnMap,
  extraTags: string[] = [],
): ImportRow[] {
  const cell = (row: string[], index?: number) => (index === undefined ? "" : (row[index] ?? "").trim());

  return rows.map((row, i) => {
    const line = i + 1;
    const first = cell(row, map.firstName);
    const last = cell(row, map.lastName);
    const joined = [first, last].filter(Boolean).join(" ");
    const email = cell(row, map.email);
    const phone = cell(row, map.phone);
    const name = cell(row, map.displayName) || joined || email.split("@")[0] || "";

    if (!name) return { line, contact: null, problem: "No name" };
    if (!phone && !email) return { line, contact: null, problem: "No phone or email" };

    const rowTags = map.tags !== undefined ? splitTags(cell(row, map.tags)) : [];
    // The bulk tags are applied to every row, so they go last and duplicates
    // collapse — a file that already carries "wholesale" doesn't get it twice.
    const tags = [...new Set([...rowTags, ...extraTags])];

    return {
      line,
      contact: {
        displayName: name,
        ...(cell(row, map.company) ? { company: cell(row, map.company) } : {}),
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(tags.length ? { tags } : {}),
      },
    };
  });
}
