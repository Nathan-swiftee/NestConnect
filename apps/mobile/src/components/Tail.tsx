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
 * stroked on the outer edges only, and overlaps the bubble by a pixel so the
 * shared edge is covered rather than drawn twice.
 *
 * The shape hangs off the corner and curves back up to the bubble wall, so its
 * silhouette continues the bubble's own curve instead of poking out of it.
 */

/** The width the tail adds beyond the bubble, and its height down the side. */
export const TAIL_W = 9;
export const TAIL_H = 15;

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
  // Anchored at the bubble's bottom corner (y = TAIL_H) and curving up and back
  // to the wall, so the silhouette carries on from the bubble's own edge. The
  // straight side is the one that meets the bubble and is hidden beneath it.
  const d = mine
    ? `M0 ${TAIL_H} L${TAIL_W} ${TAIL_H} C${TAIL_W} ${TAIL_H * 0.45} ${TAIL_W * 0.62} ${TAIL_H * 0.1} 0 0 Z`
    : `M${TAIL_W} ${TAIL_H} L0 ${TAIL_H} C0 ${TAIL_H * 0.45} ${TAIL_W * 0.38} ${TAIL_H * 0.1} ${TAIL_W} 0 Z`;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 0,
        // A pixel of overlap: without it antialiasing leaves a hairline of
        // background between tail and bubble on some densities.
        ...(mine ? { right: -TAIL_W + 1 } : { left: -TAIL_W + 1 }),
        width: TAIL_W,
        height: TAIL_H,
      }}
    >
      <Svg width={TAIL_W} height={TAIL_H} viewBox={`0 0 ${TAIL_W} ${TAIL_H}`}>
        {/* Fill and outline in one pass. The edge that meets the bubble is the
            straight one, and it sits under the bubble's own body, so stroking
            the whole path still only shows the outer curve. */}
        <Path d={d} fill={fill} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
