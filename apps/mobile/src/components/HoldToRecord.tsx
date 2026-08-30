import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import Animated, {
  interpolate,
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
 * The touch is handled by React Native's responder system rather than a
 * gesture handler — see the handlers below for why, which is a debugging story
 * rather than a preference.
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
   * committed React effect. So the trigger stays a hold and the driving goes
   * back to what worked: this flips a flag, and the effect below starts the
   * recorder once React has committed.
   *
   * The `await` before anything else is the point of the whole diagnostic and
   * it was briefly lost. A fire-and-forget write makes "no `press` on disk"
   * ambiguous — it could mean the press never arrived, or that it arrived and
   * the app died in the two lines below before the write landed. Those want
   * opposite investigations. Waiting first costs one small write and buys a
   * reading that means exactly one thing.
   */
  const begin = async () => {
    await mark("press");
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
   * The hold, on React Native's own touch responder rather than a gesture
   * handler.
   *
   * This is where the evidence led. The breadcrumb trail comes back reading
   * `armed` and nothing else: the microphone mounted, and then the press
   * produced no record of ever reaching JavaScript. Everything above this line
   * — the permission call, the audio mode, prepare, record — is downstream of a
   * step that never happens, which is why four readings of expo-audio found
   * nothing wrong. They were readings of code that does not run.
   *
   * What sits between a finger touching the screen and `runOnJS` delivering is
   * a native gesture handler and a worklet. `Gesture.Pan().minDistance(0)`
   * claims the touch on contact and, being the only gesture in the app whose
   * `onBegin` changes React state, does so at the exact moment React is
   * re-rendering the subtree it lives in. Making the gesture stable did not
   * help. So rather than keep guessing at what it does down there, this stops
   * using it.
   *
   * `onPressIn` / `onPressOut` on a plain `Pressable` are the same
   * press-and-release, delivered by the responder system that every button in
   * the app already uses and that the tap-to-record microphone used when
   * recording last worked. `onTouchMove` carries the slide. No worklet, no
   * native handler, no thread hop: the callbacks are ordinary JavaScript, so if
   * this still fails the trail will finally say where.
   *
   * `pressRetentionOffset` is what makes the slide survive. Without it the
   * responder gives up as soon as the finger leaves the button and reports a
   * release the moment you start sliding to cancel — which is the whole
   * interaction.
   */
  const origin = useRef({ x: 0, y: 0 });
  const offset = useRef({ dx: 0, dy: 0 });
  /** A release must be acted on once. `onPressOut` and `onTouchEnd` both fire,
   *  and in either order. */
  const done = useRef(true);

  const onIn = (e: GestureResponderEvent) => {
    origin.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    offset.current = { dx: 0, dy: 0 };
    dx.value = 0;
    dy.value = 0;
    grow.value = springTo(1.35, spring.quick);
    done.current = false;
    void begin();
  };

  const onMove = (e: GestureResponderEvent) => {
    if (done.current) return;
    // Leftward and upward only, and never past the point the hints stop moving
    // — a control that follows the finger across the screen reads as dragged
    // rather than held.
    const ndx = Math.min(0, Math.max(e.nativeEvent.pageX - origin.current.x, -CANCEL_FULL));
    const ndy = Math.min(0, Math.max(e.nativeEvent.pageY - origin.current.y, -LOCK_AT - 20));
    offset.current = { dx: ndx, dy: ndy };
    dx.value = ndx;
    dy.value = ndy;
  };

  const onOut = () => {
    if (done.current) return;
    done.current = true;
    const { dx: fx, dy: fy } = offset.current;
    grow.value = springTo(1, spring.base);
    dx.value = withTiming(0, timing.quick);
    dy.value = withTiming(0, timing.quick);
    if (fx <= -CANCEL_AT) discard();
    else if (fy <= -LOCK_AT) lock();
    else send();
  };

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

      {/* The animated view carries nothing but a transform, and a plain one
          inside it carries the disc. See `disc` for why that split is
          load-bearing rather than tidy. */}
      <Pressable
        onPressIn={onIn}
        onPressOut={onOut}
        onTouchMove={onMove}
        onTouchEnd={onOut}
        onTouchCancel={onOut}
        // Generous, because the interaction *is* leaving the button: slide left
        // to cancel, up to lock. Without this the responder reports a release
        // the moment the finger travels, and every slide sends instead.
        pressRetentionOffset={{ top: 240, bottom: 240, left: 240, right: 240 }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Hold to record a voice message"
        accessibilityHint="Hold to record, release to send. Slide left to cancel, up to lock."
      >
        <Animated.View style={button}>
          <View style={disc}>
            <MicIcon size={19} color="#fff" />
          </View>
        </Animated.View>
      </Pressable>
    </>
  );
}
