import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** The kinds of identity a contact can be matched on. */
export type IdentityKind = "phone" | "email" | "wa_id";

/** Default region for parsing numbers typed without a country code. WhatsApp
 *  always delivers a full country code, so this only affects hand-typed local
 *  numbers (e.g. "07911 123456" → +447911123456). */
export const DEFAULT_REGION: CountryCode = "GB";

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
 * - phone / wa_id → E.164 (`+447911123456`). WhatsApp sends `wa_id` as E.164
 *   digits WITHOUT the `+` (e.g. "447911123456"); a person may type
 *   "+44 7911 123456", "07911 123456", etc. All collapse to one E.164 string.
 *   Unparseable numbers fall back to a digits-only key so format variants still
 *   collapse, rather than silently forking.
 * - email → trimmed + lowercased.
 *
 * Returns null when the value is empty or obviously not an identity (e.g. an
 * email with no `@`), so callers can skip writing a junk identity.
 */
export function normalizeIdentity(kind: IdentityKind, raw: string): NormalizedIdentity | null {
  const value = raw.trim();
  if (!value) return null;

  if (kind === "email") {
    const normalized = value.toLowerCase();
    // Loose sanity — a real address has an @ and a dot in the domain.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return null;
    return { value, normalized };
  }

  // phone | wa_id — keep only digits and a leading +, then parse to E.164.
  const cleaned = value.replace(/[^\d+]/g, "");
  if (!cleaned) return null;

  // First attempt: interpret against the default region (handles national forms
  // like "07911…" and international "+44…").
  let parsed = parsePhoneNumberFromString(cleaned, DEFAULT_REGION);
  // Second attempt: a bare full-international number with no "+" (WhatsApp's
  // wa_id format, e.g. "447911123456") — prepend "+" and parse without a region.
  if (!(parsed && parsed.isValid()) && !cleaned.startsWith("+") && /^\d{7,15}$/.test(cleaned)) {
    parsed = parsePhoneNumberFromString("+" + cleaned);
  }
  const normalized = parsed && parsed.isValid() ? parsed.number : cleaned.replace(/^\+/, "");
  return { value, normalized };
}

/** Just the canonical key (or null), for lookups that don't need the raw value. */
export function normalizedKey(kind: IdentityKind, raw: string): string | null {
  return normalizeIdentity(kind, raw)?.normalized ?? null;
}
