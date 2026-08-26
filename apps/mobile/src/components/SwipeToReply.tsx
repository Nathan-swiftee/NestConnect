import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useState } from "react";
import { View } from "react-native";
import { haptics } from "../haptics";
import { ReplyIcon } from "../icons";
import { useTheme } from "../theme";

/**
 * `FULL` is where the arrow reaches full size; `COMMIT` is where letting go
 * actually starts a reply.
 *
 * COMMIT sits at ~80% of FULL, not at it. Two reasons, and both are about the
 * gesture being forgiving where it can afford to be:
 *
 *  - People release as they *reach* the end of a pull, not after holding it
 *    there, so a threshold at full size fires on the frame they're already
 *    easing back from. It reads as "the swipe didn't take", which is the worst
 *    outcome — you have to do it again, harder.
 *  - The pan doesn't claim the gesture until the finger has travelled
 *    `activeOffsetX`, and on some platforms translation is then reported from
 *    that point rather than from touch-down. Budgeting for the difference costs
 *    nothing; not budgeting for it makes an ordinary swipe a coin flip.
 *
 * 45pt is still well past the activation slop, so a scroll that drifts
 * sideways never trips it.
 */
const FULL = 56;
const COMMIT = 45;

/** Diameter of the arrow disc. */
const ARROW = 28;

/**
 * Swipe a bubble to reply to it, the way WhatsApp does.
 *
 * Inbound swipes right and outbound swipes left — mirrored, because the gesture
 * pulls the message toward the middle of the screen from wherever it sits. A
 * reply arrow fades in and grows behind it, reaching full size at the commit
 * point, so the feedback tells you when you've pulled far enough before you let
 * go rather than after.
 *
 * The pan is claimed only once the finger has moved further horizontally than
 * vertically (`activeOffsetX` / `failOffsetY`), so a diagonal flick still
 * scrolls the thread instead of half-starting a reply.
 *
 * Runs on the UI thread through Reanimated: a gesture driven by React state
 * stutters on a long thread, which is exactly where people use it.
 */
export function SwipeToReply({
  onReply,
  mine,
  enabled = true,
  children,
}: {
  onReply: () => void;
  /** Outbound messages swipe the other way. */
  mine: boolean;
  /** Off for internal notes and email, where there's nothing to reply *to*. */
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  const x = useSharedValue(0);
  // Measured height of the row, so the arrow can be centred on it explicitly.
  const [h, setH] = useState(0);
  const dir = mine ? -1 : 1;

  function commit() {
    // Order matters: the reply is the point, the buzz is decoration. `haptics`
    // can never throw, but keeping the real work first means it stays true even
    // if that changes.
    onReply();
    haptics.tap();
  }

  const pan = Gesture.Pan()
    // Only a decisively horizontal drag is ours; anything vertical belongs to
    // the scroll view.
    .activeOffsetX(mine ? [-12, 99999] : [-99999, 12])
    .failOffsetY([-14, 14])
    .enabled(enabled)
    .onUpdate((e) => {
      // Only in the one direction, and damped past the commit point so it can't
      // be dragged across the screen.
      const raw = dir * e.translationX;
      x.value = raw <= 0 ? 0 : raw <= FULL ? raw : FULL + (raw - FULL) * 0.2;
    })
    .onEnd(() => {
      if (x.value >= COMMIT) runOnJS(commit)();
      x.value = withTiming(0, { duration: 200 });
    });

  const bubble = useAnimatedStyle(() => ({
    transform: [{ translateX: dir * x.value }],
  }));

  const hint = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, FULL], [0, 1], "clamp"),
    transform: [{ scale: interpolate(x.value, [0, FULL], [0.55, 1], "clamp") }],
  }));

  if (!enabled) return <>{children}</>;

  return (
    <GestureDetector gesture={pan}>
      <View onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        {/* The arrow sits behind, on the side the bubble is pulled away from,
            level with the middle of it.

            Positioned from a measured height rather than stretched with
            `top: 0; bottom: 0`, because that stretch was landing the arrow at
            the top of the row instead of its centre — on a short bubble it
            appeared above the message it belonged to, next to the previous one.
            An explicit offset can't be interpreted two ways. `h` is 0 until the
            first layout, which puts the arrow at the top for one frame while it
            is still fully transparent. */}
        <Animated.View
          pointerEvents="none"
          style={[
            hint,
            {
              position: "absolute",
              top: Math.max(0, (h - ARROW) / 2),
              height: ARROW,
              justifyContent: "center",
              ...(mine ? { right: 8 } : { left: 8 }),
            },
          ]}
        >
          <View
            style={{ backgroundColor: c.surface2, height: ARROW, width: ARROW }}
            className="items-center justify-center rounded-full"
          >
            <ReplyIcon size={15} color={c.textMuted} />
          </View>
        </Animated.View>

        <Animated.View style={bubble}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
