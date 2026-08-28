import { useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { formatDuration } from "@ding/client";
import { haptics } from "../haptics";
import { BackIcon, LockIcon, MicIcon } from "../icons";
import { useTheme } from "../theme";
import { spring, springTo, timing } from "../motion";
import type { VoiceRecording } from "../voice";

/**
 * How far the finger has to travel to mean it.
 *
 * Both sit short of where the hint reaches full strength, for the reason
 * `SwipeToReply` documents: people release as they *reach* the end of a
 * movement, not after holding it there, so a threshold at the visual end fires
 * on the frame they are already easing back from.
 */
const CANCEL_AT = 90;
const LOCK_AT = 74;
/** Where the "slide to cancel" hint has faded out completely. */
const CANCEL_FULL = 120;

/**
 * Press and hold to record; release to send.
 *
 * The button used to be `onPress={() => setRecording(true)}` — a tap that put
 * the composer into a recording mode you then had to tap again to get out of.
 * Every messaging app on the device records on press-in and sends on release,
 * so people hold it, nothing happens, and they conclude the app is broken. It
 * is the single interaction users notice fastest.
 *
 * Two escapes from the hold, both WhatsApp's:
 *
 *  - **Slide left** past `CANCEL_AT` and let go: the recording is discarded.
 *    A "slide to cancel" hint tracks the finger and fades as it goes.
 *  - **Slide up** past `LOCK_AT`: the recording locks and carries on hands-free,
 *    handing over to the full panel with its pause, delete and send.
 *
 * The gesture runs on the UI thread; only the four decisions — start, send,
 * discard, lock — cross back to JS.
 */
export function HoldToRecord({
  voice,
  onSend,
  onLock,
  size = 40,
}: {
  voice: VoiceRecording;
  onSend: () => void;
  onLock: () => void;
  /** Matches the send button it replaces, so the row doesn't resize. */
  size?: number;
}) {
  const { c } = useTheme();
  const [holding, setHolding] = useState(false);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const grow = useSharedValue(1);

  const begin = () => {
    setHolding(true);
    haptics.tap();
    void voice.start();
  };
  const send = () => {
    setHolding(false);
    onSend();
  };
  const discard = () => {
    setHolding(false);
    haptics.warning();
    void voice.cancel();
  };
  const lock = () => {
    setHolding(false);
    haptics.success();
    onLock();
  };

  const hold = Gesture.Pan()
    // Claimed on touch-down rather than after any travel: this is a hold, and
    // the drag is what modifies it. `minDistance(0)` is what makes press-and-
    // hold-then-slide one gesture instead of a press that loses its own drag.
    .minDistance(0)
    .onBegin(() => {
      grow.value = springTo(1.35, spring.quick);
      runOnJS(begin)();
    })
    .onUpdate((e) => {
      // Leftward and upward only, and never past the point the hints stop
      // moving — a control that follows the finger across the screen reads as
      // dragged rather than held.
      dx.value = Math.min(0, Math.max(e.translationX, -CANCEL_FULL));
      dy.value = Math.min(0, Math.max(e.translationY, -LOCK_AT - 20));
    })
    .onEnd(() => {
      const cancelled = dx.value <= -CANCEL_AT;
      const locked = !cancelled && dy.value <= -LOCK_AT;
      grow.value = springTo(1, spring.base);
      dx.value = withTiming(0, timing.quick);
      dy.value = withTiming(0, timing.quick);
      if (cancelled) runOnJS(discard)();
      else if (locked) runOnJS(lock)();
      else runOnJS(send)();
    })
    // A cancelled gesture (a call arriving, the app backgrounding) must not
    // leave the microphone open.
    .onFinalize((_e, success) => {
      if (!success) {
        grow.value = springTo(1, spring.base);
        dx.value = withTiming(0, timing.quick);
        dy.value = withTiming(0, timing.quick);
        runOnJS(discard)();
      }
    });

  const button = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: grow.value }],
  }));

  /** The hint slides with the finger and fades as the cancel point nears. */
  const cancelHint = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, -CANCEL_AT], [1, 0.15], "clamp"),
    transform: [{ translateX: dx.value * 0.55 }],
  }));

  /** The lock target lifts and brightens as the finger comes up to meet it. */
  const lockHint = useAnimatedStyle(() => ({
    opacity: interpolate(dy.value, [0, -LOCK_AT], [0.45, 1], "clamp"),
    transform: [{ scale: interpolate(dy.value, [0, -LOCK_AT], [0.85, 1.1], "clamp") }],
  }));

  return (
    <>
      {holding ? (
        // The whole composer row becomes the recording state while held: a
        // running clock on the left, the cancel hint in the middle, the lock
        // target above the thumb.
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: -64 }}
        >
          <View className="flex-1 flex-row items-end justify-end pb-1 pr-3">
            <Animated.View
              style={[
                lockHint,
                { backgroundColor: c.surface2, borderColor: c.border },
              ]}
              className="mb-2 h-9 w-9 items-center justify-center rounded-full border"
            >
              <LockIcon size={16} color={c.textMuted} />
            </Animated.View>
          </View>

          <View
            style={{ backgroundColor: c.surface2 }}
            className="absolute bottom-0 left-0 right-0 h-11 flex-row items-center rounded-24 px-3"
          >
            <View
              style={{ backgroundColor: voice.isRecording ? c.danger : c.textFaint }}
              className="h-2 w-2 rounded-full"
            />
            <Text style={{ color: c.text }} className="ml-2.5 text-md font-semibold tabular-nums">
              {formatDuration(voice.seconds * 1000)}
            </Text>
            <Animated.View style={cancelHint} className="flex-1 flex-row items-center justify-center">
              <BackIcon size={14} color={c.textFaint} />
              <Text style={{ color: c.textFaint }} className="ml-0.5 text-sm">
                Slide to cancel
              </Text>
            </Animated.View>
          </View>
        </View>
      ) : null}

      <GestureDetector gesture={hold}>
        <Animated.View
          style={[
            button,
            { backgroundColor: holding ? c.danger : c.brand, height: size, width: size },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Hold to record a voice message"
          accessibilityHint="Hold to record, release to send. Slide left to cancel, up to lock."
          className="items-center justify-center rounded-full"
        >
          <MicIcon size={19} color="#fff" />
        </Animated.View>
      </GestureDetector>
    </>
  );
}
