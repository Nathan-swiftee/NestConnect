/**
 * The brand's own colours, and where its artwork lives.
 *
 * The mark itself is a picture, not geometry — `brand/mark.png` and its
 * siblings are the files as delivered (cleaned to a crisp edge at 2300px), and
 * everything the apps and the browser use is derived from them by
 * `tools/render-logo.mjs`. One set of source files; every size a build product.
 *
 * The 2026 brand: a two-part leaf mark and the "NestConnect" wordmark, in
 * green, mint and ink. These values are sampled from the delivered artwork.
 */
export const BRAND = {
  /** The mark's green, and the ground of the app icon and every logo tile. A
   *  logo keeps its own value in every context — this is not `colors.brand`,
   *  which is tuned for UI text and filled buttons. */
  green: "#1DAA61",
  /** The second green in the brand set. */
  leaf: "#75B94E",
  /** The light mark that sits on a green tile. */
  mint: "#E1FBD6",
  /** The mark and wordmark in one colour, on light grounds. */
  ink: "#262626",
} as const;

/**
 * Where the derived artwork ends up, for anything that needs to name a file
 * rather than import one. Kept beside the colours so the two cannot drift.
 */
export const BRAND_ASSETS = {
  /** Web, served from `public/`. The green mark, for narrow spots. */
  mark: "/logo-mark.png",
  /** The full logo, mark and "NestConnect", as delivered. */
  lockup: "/logo-lockup.png",
} as const;
