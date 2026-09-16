import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** The kinds of identity a contact can be matched on. */
export type IdentityKind = "phone" | "email" | "wa_id" | "nestchat" | "external";

/** Default region for parsing numbers typed without a country code. WhatsApp
 *  always delivers a full country code, so this only affects hand-typed local
 *  numbers (e.g. "07911 123456" → +447911123456). */
export const DEFAULT_REGION: CountryCode = "GB";

/**
 * Bump when {@link normalizeIdentity} changes what it produces for the same
 * input. Stored identity keys were written by an older version, so the store
 * re-normalises every row (and re-runs dedup) when it sees a newer number here.
 *
 * 2 — canonical form became digits-only. Before this, a number libphonenumber
 *     accepted normalised to E.164 *with* the `+` while one it rejected fell
 *     back to bare digits, so two spellings of the same number could land in
 *     different shapes and never match — forking one customer into two.
 */
export const IDENTITY_NORMALIZATION_VERSION = 2;

export interface NormalizedIdentity {
  /** The value as entered (trimmed) — kept for display. */
  value: string;
  /** The canonical form used for matching/dedup: E.164 for phones, lowercase
   *  for emails. Two inputs for the same person collapse to the same string. */
  normalized: string;
}

/**
 * Canonicalize a contact identity so the same person always resolves to the same
 * key regardless of how their phone/email was typed. This is the single choke
 * point every write path funnels through — get-or-create matches on `normalized`.
 *
 * - phone / wa_id → the digits of the E.164 number (`447911123456`). WhatsApp
 *   sends `wa_id` as exactly that; a person may type "+44 7911 123456",
 *   "07911 123456", etc. All collapse to one string.
 *
 *   Digits-only rather than true E.164 (`+4479…`) on purpose. A number
 *   libphonenumber can't parse has no E.164 form, so that branch can only fall
 *   back to raw digits — and if the other branch kept the `+`, the two would
 *   never match. Dropping it from both makes the shapes identical by
 *   construction. The `+` was never doing matching work anyway: it is the same
 *   for every international number.
 * - email → trimmed + lowercased.
 *
 * Returns null when the value is empty or obviously not an identity (e.g. an
 * email with no `@`), so callers can skip writing a junk identity.
 */
/** Everything that isn't a digit, gone. Both phone branches end here, which is
 *  the whole point: they cannot disagree about shape. */
const digitsOnly = (s: string) => s.replace(/\D/g, "");

export function normalizeIdentity(kind: IdentityKind, raw: string): NormalizedIdentity | null {
  const value = raw.trim();
  if (!value) return null;

  if (kind === "email") {
    const normalized = value.toLowerCase();
    // Loose sanity — a real address has an @ and a dot in the domain.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return null;
    return { value, normalized };
  }

  // A NestChat visitor id is already canonical — 32 hex characters this server
  // generated. Running it through the phone parser below would strip its letters
  // and try to read the rest as a number.
  if (kind === "nestchat") {
    return /^[0-9a-zA-Z_-]{8,64}$/.test(value) ? { value, normalized: value } : null;
  }

  // An external id is `inboxId:theirId`, and both halves belong to somebody
  // else's system — so it is taken exactly as given. Folding case would merge
  // two users of an app that treats "A1" and "a1" as different people, and
  // that is their call to have made, not ours to undo.
  if (kind === "external") {
    return /^[^\s:]+:.{1,120}$/.test(value) ? { value, normalized: value } : null;
  }

  // phone | wa_id — keep only digits and a leading +, then parse to E.164.
  const cleaned = value.replace(/[^\d+]/g, "");
  if (!digitsOnly(cleaned)) return null;

  // First attempt: interpret against the default region (handles national forms
  // like "07911…" and international "+44…").
  let parsed = parsePhoneNumberFromString(cleaned, DEFAULT_REGION);
  // Second attempt: a bare full-international number with no "+" (WhatsApp's
  // wa_id format, e.g. "447911123456") — prepend "+" and parse without a region.
  if (!(parsed && parsed.isValid()) && !cleaned.startsWith("+") && /^\d{7,15}$/.test(cleaned)) {
    // `?? parsed` matters: a failed second attempt must not discard a usable
    // first one.
    parsed = parsePhoneNumberFromString("+" + cleaned) ?? parsed;
  }
  // Any successful parse wins, valid or not. libphonenumber still produces a
  // canonical international form for a number it merely doubts — and that is
  // exactly the case that used to fork, because the national and international
  // spellings of one doubted number fell into different branches. Only a string
  // it cannot parse at all falls back to raw digits, where format variants still
  // collapse on the digits themselves.
  const normalized = parsed ? digitsOnly(parsed.number) : digitsOnly(cleaned);
  return { value, normalized };
}

/** Just the canonical key (or null), for lookups that don't need the raw value. */
export function normalizedKey(kind: IdentityKind, raw: string): string | null {
  return normalizeIdentity(kind, raw)?.normalized ?? null;
}
