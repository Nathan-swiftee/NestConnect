/**
 * Business Ops on the phone: small things the library and reader share.
 * Reading, searching, ticking and confirming happen here; writing SOPs stays on
 * the web (see docs/business-ops.md).
 */

/** A colour at low strength, for an SOP's tinted tile. */
export function tint(hex: string, alpha = 0.14): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(127, 127, 127, ${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** "example.com" from a link, for a step's link chip. */
export function hostOf(url: string): string {
  const m = /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url);
  return m ? m[1]! : "Link";
}
