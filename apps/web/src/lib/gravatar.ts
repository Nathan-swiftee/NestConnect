import { useEffect, useState } from "react";

/**
 * Resolve a contact's Gravatar image URL from their email. Gravatar accepts a
 * SHA-256 hash of the lower-cased, trimmed address (computed here with Web
 * Crypto). `d=404` makes Gravatar 404 when the person has no photo, so callers
 * fall back to coloured initials on the <img>'s error event.
 *
 * WhatsApp deliberately doesn't expose customer profile photos, so this is our
 * "real photo when we can get one" path — email contacts with a Gravatar.
 */
const cache = new Map<string, string>();

async function computeUrl(email: string): Promise<string> {
  const hit = cache.get(email);
  if (hit) return hit;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const hash = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const url = `https://www.gravatar.com/avatar/${hash}?d=404&s=160`;
  cache.set(email, url);
  return url;
}

export function useGravatar(email?: string | null): string | null {
  const normalized = email?.trim().toLowerCase() || "";
  const [url, setUrl] = useState<string | null>(() => (normalized ? cache.get(normalized) ?? null : null));
  useEffect(() => {
    if (!normalized || typeof crypto === "undefined" || !crypto.subtle) {
      setUrl(null);
      return;
    }
    let alive = true;
    computeUrl(normalized)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [normalized]);
  return url;
}
