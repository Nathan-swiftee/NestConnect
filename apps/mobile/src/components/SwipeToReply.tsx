import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { View } from "react-native";
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
  const dir = mine ? -1 : 1;

  function commit() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply();
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
      <View>
        {/* The arrow sits behind, on the side the bubble is pulled away from. */}
        <Animated.View
          pointerEvents="none"
          style={[
            hint,
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              justifyContent: "center",
              ...(mine ? { right: 8 } : { left: 8 }),
            },
          ]}
        >
          <View
            style={{ backgroundColor: c.surface2 }}
            className="h-7 w-7 items-center justify-center rounded-full"
          >
            <ReplyIcon size={15} color={c.textMuted} />
          </View>
        </Animated.View>

        <Animated.View style={bubble}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
