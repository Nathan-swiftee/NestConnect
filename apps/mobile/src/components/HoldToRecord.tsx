import { useEffect, useState } from "react";
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
import { beginTrail, mark } from "../diagnostics";
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
}: {
  voice: VoiceRecording;
  onSend: () => void;
  onLock: () => void;
}) {
  const { c } = useTheme();
  const [holding, setHolding] = useState(false);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const grow = useSharedValue(1);

  /**
   * Every step of the press, written to disk before it runs.
   *
   * Holding the microphone takes the app down on Android with no error and no
   * JS stack, and three readings of the code produced three wrong causes. The
   * trail replaces reading with measuring: whichever call kills the process,
   * its name is the last thing written. `src/diagnostics.ts` explains why it
   * awaits, and Settings shows what survived.
   *
   * The awaits here delay the visual response by the length of one small
   * key-value write. That is a few milliseconds against a bug that closes the
   * app, and it comes out again the moment the cause is known.
   */
  const begin = async () => {
    await beginTrail("press");
    setHolding(true);
    await mark("haptic");
    haptics.tap();
    await mark("start");
    await voice.start();
  };
  const send = () => {
    void mark("release:send");
    setHolding(false);
    onSend();
  };
  const discard = () => {
    void mark("release:discard");
    setHolding(false);
    haptics.warning();
    void voice.cancel();
  };
  const lock = () => {
    void mark("release:lock");
    setHolding(false);
    haptics.success();
    onLock();
  };

  /**
   * Proof that the recording overlay rendered.
   *
   * An effect runs after the commit, so reaching this at all means the two
   * animated views below mounted without taking the process with them — which
   * is a real candidate, since they appear mid-gesture while the shared values
   * they read are being written from the UI thread.
   *
   * Fire-and-forget is fine here and nowhere else: `mark` appends to the trail
   * synchronously and every later step persists the whole list, so this entry
   * lands on disk as soon as anything after it does. Its job is to say the
   * render already survived, not to be the last word.
   */
  useEffect(() => {
    if (holding) void mark("overlay");
  }, [holding]);

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

  /**
   * The disc itself — size, shape and colour included, rather than left to a
   * `className` beside this.
   *
   * On this stack a `useAnimatedStyle` value in `style` takes the whole element
   * with it: the class-derived styles are dropped and so is any other inline
   * style object. That is how the microphone shipped as a bare white glyph on
   * nothing — the transform was here, `h-10 w-10 rounded-full` was in the
   * className, and only the transform survived, collapsing the button to the
   * size of its icon. `__tests__/interop-probe.test.tsx` holds the measurement.
   *
   * So: one style object per animated element, everything in it.
   *
   * 35, not 40: NativeWind's rem on native is 14, so the `h-10` this replaces
   * was 2.5 × 14. Every number below is a Tailwind class converted at that rate.
   */
  const button = useAnimatedStyle(() => ({
    height: 35,
    width: 35,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: holding ? c.danger : c.brand,
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: grow.value }],
  }));

  /** The hint slides with the finger and fades as the cancel point nears. */
  const cancelHint = useAnimatedStyle(() => ({
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    opacity: interpolate(dx.value, [0, -CANCEL_AT], [1, 0.15], "clamp"),
    transform: [{ translateX: dx.value * 0.55 }],
  }));

  /** The lock target lifts and brightens as the finger comes up to meet it. */
  const lockHint = useAnimatedStyle(() => ({
    marginBottom: 7,
    height: 31.5,
    width: 31.5,
    borderRadius: 9999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface2,
    borderColor: c.border,
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
            <Animated.View style={lockHint}>
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
            <Animated.View style={cancelHint}>
              <BackIcon size={14} color={c.textFaint} />
              <Text style={{ color: c.textFaint }} className="ml-0.5 text-sm">
                Slide to cancel
              </Text>
            </Animated.View>
          </View>
        </View>
      ) : null}

      {/* A plain View between the detector and the styled one, the way
          `SwipeToReply` does it. No className on the disc — `button` carries the
          whole appearance, for the reason set out where it is defined. */}
      <GestureDetector gesture={hold}>
        <View>
          <Animated.View
            style={button}
            accessibilityRole="button"
            accessibilityLabel="Hold to record a voice message"
            accessibilityHint="Hold to record, release to send. Slide left to cancel, up to lock."
          >
            <MicIcon size={19} color="#fff" />
          </Animated.View>
        </View>
      </GestureDetector>
    </>
  );
}
