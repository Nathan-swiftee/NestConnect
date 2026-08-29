import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * The little pointer that makes a rounded rectangle read as speech.
 *
 * It sits on the **bottom** outer corner of the **last** bubble in a run — not
 * every bubble, and not the first. That placement is what does the work: it
 * anchors the end of each turn to its side of the thread, so a column reads as
 * alternating speech rather than a stack of cards, and five messages from one
 * person read as one turn rather than five. A tail on every bubble undoes that
 * and looks noisy.
 *
 * Bottom rather than top is deliberate: it's where the web puts it (`bottom:0`
 * on `.msg .bubble::after`) and where WhatsApp puts it, and the two clients
 * have to agree or the same thread looks like two different products.
 *
 * Drawn as SVG rather than the usual rotated-square-with-a-border trick, for
 * two reasons that both come from these bubbles having a visible border:
 * a rotated square shows its own border on the inside edge where it meets the
 * bubble, and the seam moves as you change radius. A path can be filled and
 * stroked on the outer edges only, and overlaps the bubble so the shared edge
 * is covered rather than drawn twice.
 *
 * The shape hangs off the corner and curves back up to the bubble wall, so its
 * silhouette continues the bubble's own curve instead of poking out of it.
 *
 * ## Two paths, not one
 *
 * It was one path, `Z`-closed, filled and stroked in a single pass — and it
 * read as a separate piece stuck onto the bubble. Two seams did that:
 *
 *  - **The joint was stroked.** A closed path strokes every edge, including the
 *    straight one that meets the bubble. Because the tail renders as a child of
 *    the bubble it draws *over* the bubble's fill, so that stroke showed as a
 *    line ruled down the bubble's own face at the join.
 *  - **The outer stroke was clipped in half.** The viewBox was exactly the
 *    shape's bounding box, so a 1pt stroke centred on the boundary lost its
 *    outer half — leaving the tail outlined at half the weight of the bubble's
 *    own border, which is precisely the cue that says "different element".
 *
 * So: a filled path that reaches further under the bubble than it needs to, and
 * a separate *open* path stroking only the outer curve, inside a viewBox padded
 * enough to hold the full stroke.
 */

/** The width the tail adds beyond the bubble, and its height down the side. */
export const TAIL_W = 9;
export const TAIL_H = 15;

/**
 * How far the fill reaches back under the bubble.
 *
 * Only the fill — the outline stops at the bubble wall. Overlapping by a whole
 * radius rather than the old single pixel means no antialiasing seam can appear
 * at the join even part-way through a scroll, and nothing is visible because
 * the bubble's own fill is the same colour.
 */
const UNDERLAP = 4;

/** Room in the viewBox for the stroke, which would otherwise be clipped to half
 *  its width along the outer edge. */
const BLEED = 1;

/**
 * The radius the tailed corner should use.
 *
 * A tail growing out of a 16pt round corner floats — there's a visible gap of
 * background between the two curves. Squaring that one corner is what lets them
 * read as a single outline.
 */
export const tailCorner = 5;

export function Tail({
  /** Which side of the thread this bubble is on. */
  mine,
  /** The bubble's own fill, so the tail is the same object. */
  fill,
  /** The bubble's border colour. Pass the fill to draw an unbordered tail. */
  stroke,
}: {
  mine: boolean;
  fill: string;
  stroke: string;
}) {
  // The canvas holds the tail, the underlap that hides beneath the bubble, and
  // a bleed either side so the stroke is never clipped.
  const W = TAIL_W + UNDERLAP + BLEED * 2;
  const H = TAIL_H + BLEED * 2;
  // Where the bubble's wall falls inside that canvas. The tail hangs outward
  // from here; everything on the other side is under the bubble.
  const wall = mine ? BLEED + UNDERLAP : BLEED + TAIL_W;
  // The far edge of the tail, and the corner it hangs from.
  const tip = mine ? BLEED + UNDERLAP + TAIL_W : BLEED;
  const base = BLEED + TAIL_H;
  // The control points that bring the outer edge back up to the wall, so the
  // silhouette carries on from the bubble's own curve rather than poking out.
  // The first holds the tip's line briefly; the second pulls back toward the
  // wall, 62% of the way across.
  const c2 = wall + (mine ? 1 : -1) * TAIL_W * 0.62;

  /** The outer edge only: down the tail's far side and back up to the wall. */
  const outline =
    `M${wall} ${base} L${tip} ${base} ` +
    `C${tip} ${BLEED + TAIL_H * 0.45} ${c2} ${BLEED + TAIL_H * 0.1} ${wall} ${BLEED}`;
  /** The same edge, closed back through the bubble so there is a region to
   *  fill. The closing edges are under the bubble and never drawn. */
  const body = `${outline} L${mine ? BLEED : W - BLEED} ${BLEED} L${mine ? BLEED : W - BLEED} ${base} Z`;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: -BLEED,
        // Shifted by the underlap so the tail itself still starts exactly at
        // the bubble's edge while the fill continues back underneath it.
        ...(mine
          ? { right: -(TAIL_W + BLEED) }
          : { left: -(TAIL_W + BLEED) }),
        width: W,
        height: H,
      }}
    >
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Fill first, reaching under the bubble. */}
        <Path d={body} fill={fill} />
        {/* Then the outline, on the outer edge alone — open, so nothing is
            stroked where the tail meets the bubble. `strokeLinecap="round"`
            rather than butt: the two ends of this stroke meet the bubble's own
            border, and a square cap leaves a visible corner where a round one
            merges into it. */}
        <Path
          d={outline}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
