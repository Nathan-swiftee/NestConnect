/**
 * The brand's own colours, and where its artwork lives.
 *
 * The mark itself is a picture, not geometry — `brand/mark.png` and its two
 * siblings are the files as delivered, and everything the apps and the browser
 * use is derived from them by `tools/render-logo.mjs`. That indirection is the
 * point: before it, the web drew a chat bubble with an amber dot and the phone
 * drew three nested bowls, two hand-maintained logos for one product, neither
 * aware of the other. Now there is one set of source files and every size is a
 * build product of them.
 *
 * These values are sampled from that artwork rather than typed from memory —
 * the green is the commonest opaque pixel in the mark, the navy is the tile the
 * app icon stands on.
 */
export const BRAND = {
  /** The mark's green. Not `colors.brand`, which is tuned for small UI text and
   *  filled buttons against an app surface; a logo keeps its own value in every
   *  context, including on somebody else's white page. */
  green: "#02D6A2",
  /** The ground under the app icon, and under the mark wherever it needs a tile
   *  of its own — the web's rail badge, the Apple touch icon. */
  navy: "#071634",
} as const;

/**
 * Where the derived artwork ends up, for anything that needs to name a file
 * rather than import one. Kept beside the colours so the two cannot drift.
 */
export const BRAND_ASSETS = {
  /** Web, served from `public/`. */
  mark: "/logo-mark.png",
  lockup: "/logo-lockup.png",
} as const;
