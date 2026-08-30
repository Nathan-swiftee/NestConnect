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

export type Hold = ReturnType<typeof useHoldToRecord>;

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
 * Split into a hook and two views because the hold is drawn in two places that
 * cannot be siblings. The microphone is one small element at the end of the
 * composer row; the recording bar has to span the whole row. React Native
 * positions an absolute child against its parent, with no way to escape it, so
 * a bar rendered next to the button is confined to the button's 35 points and
 * appears as a stub underneath it. The state lives in the hook, and the two
 * views read it from where each of them actually belongs in the tree.
 */
export function useHoldToRecord({
  voice,
  onSend,
  onLock,
}: {
  voice: VoiceRecording;
  onSend: () => void;
  onLock: () => void;
}) {
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
   * The microphone used to be started from inside the callback a gesture
   * handler hands to JavaScript. The audio calls were identical to the
   * tap-to-record version that worked — same functions, same order, same
   * arguments; what changed was that they ran from inside a live gesture rather
   * than from a committed React effect. So the trigger stays a hold and the
   * driving goes back to what worked: this flips a flag, and the effect below
   * starts the recorder once React has committed.
   *
   * The `await` before anything else is deliberate. A fire-and-forget write
   * makes "no `press` on disk" ambiguous — it could mean the press never
   * arrived, or that it arrived and the app died in the two lines below before
   * the write landed. Those want opposite investigations.
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
   * An effect runs after the commit, so by the time the recorder is touched the
   * render that shows the recording bar has already survived, and nothing is
   * being asked of the audio stack from inside a live touch.
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
   * This is where the evidence led, and it is the fix. The breadcrumb trail
   * came back reading `armed` and nothing after it: the microphone had mounted,
   * and the press left no record of ever reaching JavaScript. Everything
   * downstream — permission, audio mode, prepare, record — was being read for
   * four rounds, and none of it runs.
   *
   * What sat between a finger touching the screen and `runOnJS` delivering was
   * a native gesture handler and a worklet. `Gesture.Pan().minDistance(0)`
   * claims the touch on contact, and this was the only gesture in the app whose
   * `onBegin` changed React state, so it did that while React re-rendered the
   * subtree it lived in. Making the gesture stable did not help; removing it
   * did.
   *
   * `onPressIn` / `onPressOut` are the same press and release, carried by the
   * responder system every other button in this app already uses — and the one
   * the tap-to-record microphone used when recording last worked. `onTouchMove`
   * carries the slide. No worklet, no native handler, no thread hop.
   *
   * `pressRetentionOffset` is what makes the slide survive: without it the
   * responder gives up as soon as the finger leaves the button and reports a
   * release the moment you start sliding to cancel, which is the whole
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

  return { holding, dx, dy, grow, onIn, onMove, onOut };
}

/**
 * The microphone itself, in its place at the end of the composer row.
 *
 * The animated view carries nothing but a transform and a plain child carries
 * the disc. That split is load-bearing rather than tidy, for two reasons that
 * pull in the same direction. On this stack a `useAnimatedStyle` value in
 * `style` takes the whole element with it — a `className` beside it is dropped,
 * which is what once shipped the microphone as a white glyph on nothing
 * (`__tests__/interop-probe.test.tsx` holds the measurement). And touch-down
 * springs `grow`, so with width, height and radius in that same style every
 * frame of the spring asked for a layout pass on a flex child of the row from
 * the UI thread. Nesting satisfies both: nothing sits beside an animated style,
 * and the animated one only asks for a transform.
 *
 * 35, not 40: NativeWind's rem on native is 14, so the `h-10` these numbers
 * replace was 2.5 × 14.
 */
export function HoldMic({ hold }: { hold: Hold }) {
  const { c } = useTheme();
  const button = useAnimatedStyle(() => ({
    transform: [
      { translateX: hold.dx.value },
      { translateY: hold.dy.value },
      { scale: hold.grow.value },
    ],
  }));

  return (
    <Pressable
      onPressIn={hold.onIn}
      onPressOut={hold.onOut}
      onTouchMove={hold.onMove}
      onTouchEnd={hold.onOut}
      onTouchCancel={hold.onOut}
      // Generous, because the interaction *is* leaving the button: slide left
      // to cancel, up to lock. Without this the responder reports a release the
      // moment the finger travels, and every slide sends instead.
      pressRetentionOffset={{ top: 240, bottom: 240, left: 240, right: 240 }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Hold to record a voice message"
      accessibilityHint="Hold to record, release to send. Slide left to cancel, up to lock."
    >
      <Animated.View style={button}>
        <View
          style={{
            height: 35,
            width: 35,
            borderRadius: 9999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hold.holding ? c.danger : c.brand,
          }}
        >
          <MicIcon size={19} color="#fff" />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * What the composer row becomes while the microphone is held: a running clock
 * on the left, the cancel hint in the middle, the lock target floating above.
 *
 * It renders beside the row rather than inside the microphone, and that is the
 * whole reason this file has three exports. React Native positions an absolute
 * child against its parent and gives it no way out, so while this lived next to
 * the button it was clipped to the button's 35 points — the clock and the red
 * dot appearing as a stub tucked under the microphone instead of a bar across
 * the composer. The locked panel looked right because it replaces the row
 * outright and never had the problem.
 *
 * Hidden rather than absent. It used to mount on touch-down, which created two
 * animated views mid-touch while the values their styles read were already
 * being written. Mounting once and fading in removes that question; at zero
 * opacity it draws nothing, and it never took touches.
 */
export function HoldOverlay({ hold, voice }: { hold: Hold; voice: VoiceRecording }) {
  const { c } = useTheme();

  /** The hint slides with the finger and fades as the cancel point nears. */
  const cancelHint = useAnimatedStyle(() => ({
    opacity: interpolate(hold.dx.value, [0, -CANCEL_AT], [1, 0.15], "clamp"),
    transform: [{ translateX: hold.dx.value * 0.55 }],
  }));

  /** The lock target lifts and brightens as the finger comes up to meet it. */
  const lockHint = useAnimatedStyle(() => ({
    opacity: interpolate(hold.dy.value, [0, -LOCK_AT], [0.45, 1], "clamp"),
    transform: [{ scale: interpolate(hold.dy.value, [0, -LOCK_AT], [0.85, 1.1], "clamp") }],
  }));

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        top: -64,
        opacity: hold.holding ? 1 : 0,
      }}
    >
      <View className="flex-1 flex-row items-end justify-end pb-1 pr-3">
        <Animated.View style={lockHint}>
          <View
            style={{
              marginBottom: 7,
              height: 31.5,
              width: 31.5,
              borderRadius: 9999,
              borderWidth: 1,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: c.surface2,
              borderColor: c.border,
            }}
          >
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
        {/* The flex lives on a plain parent so the animated view in the middle
            carries only what the compositor can apply by itself. */}
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
        {/* The microphone sits at the right-hand end of the row underneath, and
            the bar must not cover it — it is still under the finger, and
            covering it is what would make the hold end mid-recording. */}
        <View style={{ width: 41 }} />
      </View>
    </View>
  );
}
