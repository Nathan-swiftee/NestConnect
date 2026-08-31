/**
 * The Nest Connect mark, as geometry rather than a picture.
 *
 * An `n` drawn in one thick stroke with a node at each of its three ends: the
 * shoulder of the letter is also the arc between two connected points, which is
 * the product in one shape — separate places, joined. It reads at 16 points and
 * at 1024, which a mark has to, because it is the favicon, the app icon, the
 * splash and the thing on the sign-in screen all at once.
 *
 * ## Why it lives here and not as a file
 *
 * The web and the phone both draw it, at half a dozen sizes, in two themes, and
 * before this there were *two different logos* — a speech bubble with an amber
 * dot on the web, three nested bowls on mobile. Neither knew about the other.
 * One set of numbers is what stops that happening again, and geometry travels
 * where a PNG cannot: `react-native-svg` and the DOM both take these strings
 * unchanged, and the raster assets are generated from them rather than drawn
 * separately and left to drift.
 *
 * ## The numbers
 *
 * Everything is a 100×100 box, sized so the mark's bounding box is centred in
 * it — so a caller can scale it to any size and it stays optically middled
 * without a correction. The proportions are the mark's own and are not free
 * parameters: the stroke is 0.40 of a node's diameter, the two feet stand 1.81
 * diameters apart, and the top node sits 1.73 above them. Change one and it
 * stops being the logo.
 */

/** The stroke's centreline: the left stem, and the shoulder that becomes the
 *  right stem. Two subpaths, so the corner at the top node stays a join of two
 *  round caps rather than a mitre. */
export const MARK_STEM = "M26.5 27.5V72.5";
export const MARK_ARCH = "M26.5 27.5C44.5 21.5 73.5 25.5 73.5 53.5V72.5";

/** Where the three nodes sit, in the same box. */
export const MARK_NODES = [
  { cx: 26.5, cy: 27.5 },
  { cx: 26.5, cy: 72.5 },
  { cx: 73.5, cy: 72.5 },
] as const;

/** A node's radius, and the width of the stroke between them. The stroke is
 *  deliberately narrower — the waist where one meets the other is what makes
 *  them read as joined points rather than as a single fat letter. */
export const MARK_NODE_R = 13;
export const MARK_STROKE = 10.5;

/**
 * The brand's own colours, which are not the UI's.
 *
 * `colors.brand` is tuned to carry small green text and a filled button against
 * an app surface; a logo is a logo and keeps its own value in every context,
 * including on someone else's white page. The navy is the wordmark's, and the
 * ground the app icon stands on.
 */
export const BRAND = {
  green: "#0FC08A",
  navy: "#0B1F3F",
} as const;
