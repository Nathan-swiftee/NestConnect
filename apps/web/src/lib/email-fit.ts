/**
 * How much to shrink an email so all of it shows in the message column.
 *
 * Designed emails are often laid out at a fixed width (600px is the norm), and
 * no amount of `max-width` reaches a nested fixed-width table. Rather than cut
 * the right-hand side off, the whole email is drawn at its own width and scaled
 * down to fit, the way mail apps do. Never scaled up: a narrow email stays at
 * its natural size and simply fills the column.
 *
 * `contentWidth` is how wide the email lays itself out; `boxWidth` is the room
 * there is. Returns the scale (≤ 1) and the width to lay the email out at.
 */
export function emailFit(contentWidth: number, boxWidth: number): { scale: number; width: number | null } {
  if (!(boxWidth > 0) || !(contentWidth > boxWidth + 1)) return { scale: 1, width: null };
  return { scale: boxWidth / contentWidth, width: Math.ceil(contentWidth) };
}
