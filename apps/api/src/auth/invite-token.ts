import { randomBytes, createHash } from "node:crypto";

/** How long an emailed invite stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** SHA-256 (hex) of an invite token. The raw token has 256 bits of entropy, so a
 *  fast hash is safe here and keeps the stored value directly queryable. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a single-use invite token plus the value we store and its expiry. */
export function newInviteToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
}
