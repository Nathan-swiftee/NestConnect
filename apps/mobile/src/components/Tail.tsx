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
 * ## Fill only, and why the bubbles lost their border
 *
 * This shipped twice as a stroked shape and was reported both times as looking
 * like a separate piece stuck onto the bubble. It was — and no adjustment of
 * the curve was going to fix it, because the cause was the *outline*, not the
 * shape. A tail drawn as its own path has its own outline, and that outline has
 * to meet the bubble's border at two points; a join between two separately
 * stroked shapes is visible at any size and at any radius.
 *
 * Rendering it at 7× and looking at it settled in one pass what two rounds of
 * reasoning about control points had not: every bordered variant showed the
 * seam, every borderless one was clean.
 *
 * So the tail has no outline. It is one filled shape in the bubble's own
 * colour, reaching back underneath it, which makes a seam impossible rather
 * than merely small. The bubbles gave up their border to allow that, and the
 * thread's background went a step deeper in exchange so a white bubble still
 * reads — see the note on the thread background in `thread/[id].tsx`. That is
 * also exactly how WhatsApp is built, which is why theirs has never had this
 * problem.
 */

/**
 * The width the tail adds beyond the bubble, and its height down the side.
 *
 * Small. It was 9×15 against a bubble around 30 tall, which is not a flick off
 * the corner but a lump hanging from it — the other half of "pieced on".
 */
export const TAIL_W = 7;
export const TAIL_H = 9;

/**
 * How far the fill reaches back under the bubble.
 *
 * Nothing depends on the exact figure: it is the same colour as what it hides
 * beneath, and its only job is to leave no chance of a hairline of background
 * showing at the join on any pixel density.
 */
const UNDERLAP = 4;

/**
 * The radius the tailed corner should use.
 *
 * A tail growing out of a 16pt round corner floats — there's a visible gap of
 * background between the two curves. Nearly squaring that one corner is what
 * lets them read as a single shape.
 */
export const tailCorner = 2;

export function Tail({
  /** Which side of the thread this bubble is on. */
  mine,
  /** The bubble's own fill, so the tail is literally the same object. */
  fill,
}: {
  mine: boolean;
  fill: string;
}) {
  const W = TAIL_W + UNDERLAP;
  // Where the bubble's wall falls inside the canvas: the tail hangs outward
  // from here, and everything on the other side is hidden under the bubble.
  const wall = mine ? UNDERLAP : TAIL_W;
  const tip = mine ? UNDERLAP + TAIL_W : 0;
  const far = mine ? 0 : W;
  const s = mine ? 1 : -1;

  // Out along the bottom to the tip, then back up to the wall — arriving very
  // nearly vertically, so the curve merges into the bubble's side rather than
  // meeting it at an angle. Closed back through the bubble, where the closing
  // edges are never seen.
  const d =
    `M${wall} ${TAIL_H} L${tip} ${TAIL_H} ` +
    `C${tip} ${TAIL_H * 0.5} ${wall + s * TAIL_W * 0.06} ${TAIL_H * 0.34} ${wall} 0 ` +
    `L${far} 0 L${far} ${TAIL_H} Z`;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 0,
        ...(mine ? { right: -TAIL_W } : { left: -TAIL_W }),
        width: W,
        height: TAIL_H,
      }}
    >
      <Svg width={W} height={TAIL_H} viewBox={`0 0 ${W} ${TAIL_H}`}>
        <Path d={d} fill={fill} />
      </Svg>
    </View>
  );
}
