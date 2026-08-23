import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * The little pointer that makes a rounded rectangle read as speech.
 *
 * WhatsApp puts it on the **top** outer corner of the **first** bubble in a run
 * — not the bottom, and not on every bubble. That placement is what does the
 * work: it anchors the start of each turn to its side of the thread, so a
 * column of bubbles reads as alternating speech rather than a stack of cards,
 * and a run of five messages from one person reads as one turn rather than
 * five. Putting a tail on every bubble undoes that and looks noisy.
 *
 * Drawn as SVG rather than the usual rotated-square-with-a-border trick, for
 * two reasons that both come from these bubbles having a visible border:
 * a rotated square shows its own border on the inside edge where it meets the
 * bubble, and the seam moves as you change radius. A path can be filled and
 * stroked on the outer edges only, and overlaps the bubble by a pixel so the
 * shared edge is covered rather than drawn twice.
 *
 * The shape hangs off the corner and curves back to the bubble wall, so its
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
  // Outer edge: down the side, then a curve sweeping back in to the wall.
  // Inner edge: straight back up the bubble wall, overlapping it by a hair so
  // the two fills meet with no seam between them.
  const d = mine
    ? `M0 0 L${TAIL_W} 0 C${TAIL_W} ${TAIL_H * 0.55} ${TAIL_W * 0.62} ${TAIL_H * 0.9} 0 ${TAIL_H} Z`
    : `M${TAIL_W} 0 L0 0 C0 ${TAIL_H * 0.55} ${TAIL_W * 0.38} ${TAIL_H * 0.9} ${TAIL_W} ${TAIL_H} Z`;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
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
