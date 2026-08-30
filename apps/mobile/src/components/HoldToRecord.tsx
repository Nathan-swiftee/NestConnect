import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { armTrail, mark } from "../diagnostics";
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

  // One step on disk before anything is touched, so an empty reading means
  // "this bundle has no diagnostic" rather than "the press did nothing". See
  // `armTrail`.
  useEffect(() => {
    void armTrail();
  }, []);

  /**
   * Touch down: say so, and nothing else.
   *
   * The microphone used to be started from right here, inside the callback the
   * gesture hands to JavaScript. That is one of the structural differences
   * between this and the tap-to-record version that worked — the audio calls
   * themselves are identical, in the same order, with the same arguments; what
   * changed is that they ran from inside a live gesture rather than from a
   * committed React effect.
   *
   * So the trigger stays a hold and the driving goes back to what worked: this
   * flips a flag, and the effect below starts the recorder once React has
   * committed.
   */
  const begin = () => {
    void mark("press");
    haptics.tap();
    setHolding(true);
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
   * One stable handle onto the four decisions, so the gesture below never has
   * to be rebuilt.
   *
   * `runOnJS` needs the same function object for the life of the gesture, and
   * the four above are fresh closures on every render — they capture `voice`,
   * which is a new object each time. A ref holds the current set and four
   * stable wrappers read it, so the callbacks the gesture closes over never
   * change while what they do is always current.
   */
  const latest = useRef({ begin, send, discard, lock });
  latest.current = { begin, send, discard, lock };
  const callBegin = useCallback(() => latest.current.begin(), []);
  const callSend = useCallback(() => latest.current.send(), []);
  const callDiscard = useCallback(() => latest.current.discard(), []);
  const callLock = useCallback(() => latest.current.lock(), []);

  /**
   * Start recording, from a committed effect.
   *
   * This is where `VoiceRecorder` used to do it, back when tapping the
   * microphone mounted a panel and the panel's mount effect began the take.
   * That arrangement worked; driving the same calls from a gesture callback
   * never has. An effect runs after the commit, so by the time the recorder is
   * touched the render that mounts the recording overlay has already survived,
   * and nothing is being asked of the audio stack from inside a live gesture.
   *
   * `voice` is deliberately not a dependency: it is a fresh object on every
   * render, and the clock re-renders this four times a second while recording —
   * depending on it would restart the take on every tick.
   */
  useEffect(() => {
    if (!holding) return;
    let alive = true;
    void (async () => {
      await mark("committed");
      // Released between the commit and here — rare, but a recording nobody is
      // holding would have nothing to stop it.
      if (alive) await voice.start();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  /**
   * Built once, never rebuilt.
   *
   * This was a bare `Gesture.Pan()` in the render body, so every render handed
   * `GestureDetector` a brand-new gesture object and the detector reconfigured
   * its native handler to match. react-native-gesture-handler asks for stable
   * gestures for exactly that reason, and this component breaks the rule at the
   * worst possible moment: the first thing touch-down does is `setHolding(true)`,
   * so a re-render — and a native handler swap — lands a millisecond into a pan
   * that is still live. It then happens again on every tick of the recording
   * clock, four times a second, for as long as the thumb is down.
   *
   * That is also consistent with the one hard fact this bug has produced: the
   * breadcrumb trail comes back empty. Something is ending the process on the
   * native side before any JavaScript of ours gets to run, and a handler being
   * torn down mid-touch is that shape of failure.
   *
   * `[]` is the correct dependency list, not a shortcut — everything the
   * callbacks need is either a shared value or read through `latest`.
   */
  const hold = useMemo(
    () =>
      Gesture.Pan()
        // Claimed on touch-down rather than after any travel: this is a hold,
        // and the drag is what modifies it. `minDistance(0)` is what makes
        // press-and-hold-then-slide one gesture instead of a press that loses
        // its own drag.
        .minDistance(0)
        .onBegin(() => {
          grow.value = springTo(1.35, spring.quick);
          runOnJS(callBegin)();
        })
        .onUpdate((e) => {
          // Leftward and upward only, and never past the point the hints stop
          // moving — a control that follows the finger across the screen reads
          // as dragged rather than held.
          dx.value = Math.min(0, Math.max(e.translationX, -CANCEL_FULL));
          dy.value = Math.min(0, Math.max(e.translationY, -LOCK_AT - 20));
        })
        .onEnd(() => {
          const cancelled = dx.value <= -CANCEL_AT;
          const locked = !cancelled && dy.value <= -LOCK_AT;
          grow.value = springTo(1, spring.base);
          dx.value = withTiming(0, timing.quick);
          dy.value = withTiming(0, timing.quick);
          if (cancelled) runOnJS(callDiscard)();
          else if (locked) runOnJS(callLock)();
          else runOnJS(callSend)();
        })
        // A cancelled gesture (a call arriving, the app backgrounding) must not
        // leave the microphone open.
        .onFinalize((_e, success) => {
          if (!success) {
            grow.value = springTo(1, spring.base);
            dx.value = withTiming(0, timing.quick);
            dy.value = withTiming(0, timing.quick);
            runOnJS(callDiscard)();
          }
        }),
    [dx, dy, grow, callBegin, callSend, callDiscard, callLock],
  );

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

  /**
   * The appearance, on a plain view *inside* each animated one.
   *
   * These three used to carry their size, shape and colour in the animated
   * style itself, because an animated style displaces anything beside it —
   * a `className` on the same element is dropped, which is what once left the
   * microphone as a white glyph on nothing.
   *
   * Nesting satisfies both rules at once, and it is the arrangement the tab
   * bar's travelling pill already uses on this same device: the animated view
   * carries nothing but `transform` and `opacity`, which the compositor can
   * apply on its own, and a plain child carries the layout, which it cannot.
   * Nothing is beside an animated style, so nothing is displaced.
   *
   * Why it matters here rather than being tidiness: touch-down springs `grow`
   * before a single line of our JavaScript runs. With width, height and radius
   * in that same style, every frame of that spring asked for a layout pass on a
   * flex child of the composer row, driven from the UI thread. Now it asks for
   * a transform on a view whose size never changes.
   *
   * 35, not 40: NativeWind's rem on native is 14, so the `h-10` these numbers
   * replace was 2.5 × 14.
   */
  const disc = {
    height: 35,
    width: 35,
    borderRadius: 9999,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: holding ? c.danger : c.brand,
  };
  const lockTarget = {
    marginBottom: 7,
    height: 31.5,
    width: 31.5,
    borderRadius: 9999,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: c.surface2,
    borderColor: c.border,
  };

  return (
    <>
      {/* The whole composer row becomes the recording state while held: a
          running clock on the left, the cancel hint in the middle, the lock
          target above the thumb.

          Hidden rather than absent, which is not a style preference. This used
          to be `{holding ? … : null}`, so the two animated views inside it were
          *created* on touch-down — mounted mid-gesture, while the shared values
          their styles read were already being written from the UI thread. That
          has no counterpart in the tap-to-record version that worked, and it
          happens on every single press. Mounting them once and fading them in
          removes the question entirely; they are inert at zero opacity and the
          container never took touches anyway. */}
      <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            top: -64,
            opacity: holding ? 1 : 0,
          }}
        >
          <View className="flex-1 flex-row items-end justify-end pb-1 pr-3">
            <Animated.View style={lockHint}>
              <View style={lockTarget}>
                <LockIcon size={16} color={c.textMuted} />
              </View>
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
            {/* The flex lives on a plain parent so the animated view in the
                middle carries only what the compositor can apply by itself. */}
            <View className="flex-1 flex-row items-center justify-center">
              <Animated.View style={cancelHint}>
                <View className="flex-row items-center">
                  <BackIcon size={14} color={c.textFaint} />
                  <Text style={{ color: c.textFaint }} className="ml-0.5 text-sm">
                    Slide to cancel
                  </Text>
                </View>
              </Animated.View>
            </View>
          </View>
        </View>

      {/* A plain View between the detector and the animated one, the way
          `SwipeToReply` does it — and a second plain one inside carrying the
          disc, so the animated view in between holds nothing but a transform.
          See `disc` for why that split is load-bearing rather than tidy. */}
      <GestureDetector gesture={hold}>
        <View>
          <Animated.View
            style={button}
            accessibilityRole="button"
            accessibilityLabel="Hold to record a voice message"
            accessibilityHint="Hold to record, release to send. Slide left to cancel, up to lock."
          >
            <View style={disc}>
              <MicIcon size={19} color="#fff" />
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
    </>
  );
}
