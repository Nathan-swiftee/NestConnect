import { forwardRef } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
import { cssInterop } from "nativewind";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { spring, springTo, timing, fadeTo } from "../motion";
import { haptics } from "../haptics";
import { useTheme } from "../theme";

/**
 * Everything in the app you can press.
 *
 * The app had 86 pressables and 76 of them gave the same feedback: a NativeWind
 * `active:opacity-*` class, which is a binary opacity flip — no easing, no
 * scale, no spring, and on Android no ripple. That one default was the biggest
 * single reason the app read as a web page in a native shell: a thumb landing
 * anywhere got the same nothing back.
 *
 * `Button` already had the right answer — a spring on the scale, driven from
 * `onPressIn` — but reaching for it meant importing a component that renders a
 * styled slab with a title, so nothing else could use it and the right thing
 * was never the easy thing to type. This is that press logic with the styling
 * taken out, so it drops in wherever a `Pressable` already is.
 *
 * Three responses, because a press doesn't look the same on every shape:
 *
 *  - **`chip`** — small controls: icon buttons, filter pills, tabs, reaction
 *    targets. Scales visibly, because at 32–44pt a shallow scale isn't legible.
 *  - **`slab`** — wide buttons and cards. Scales barely: the same proportional
 *    shrink on something 300pt across reads as a resize, not a press.
 *  - **`row`** — anything full-bleed: list rows, settings lines, menu items.
 *    Doesn't scale at all. A full-width row that shrinks under the finger is a
 *    web-app tell; a native row *lights up*, so this fades a surface tint in
 *    behind the content instead.
 *
 * On Android every variant also draws a real ripple, because that is the
 * platform's own answer to "was that press received", and its absence is
 * something Android users notice without being able to name.
 */

export type PressFeel = "chip" | "slab" | "row" | "none";

/** How far each shape gives. Tuned to size: the bigger the target, the less it
 *  can move before the movement reads as a resize rather than a press. */
const SCALE: Record<PressFeel, number> = {
  chip: 0.94,
  slab: 0.975,
  row: 1,
  none: 1,
};

/**
 * The pressable, animated — rather than an `Animated.View` wrapped around one.
 *
 * A wrapper would have been simpler to write and wrong at two thirds of the
 * call sites: the layout classes live on the pressable itself, and plenty of
 * them are layout-*affecting* (`flex-1` on a composer field, `absolute` on a
 * remove badge, `flex-none` on the inbox's compose button). Wrapping puts a
 * plain view between that class and its parent, so the flex child stops
 * flexing and the absolute child positions against the wrong box. Animating
 * the pressable itself leaves every call site's layout exactly as it was.
 *
 * `cssInterop` is what makes `className` survive the swap: a component created
 * by `createAnimatedComponent` is a different component object, and NativeWind
 * silently drops `className` on anything it hasn't been told about — see the
 * longer note in `src/animated.ts`. Registered here rather than there because
 * the registration has to happen before this component first renders, and
 * same-module is the only ordering that can't be broken by an import moving.
 *
 * The interop maps `className` into `style` by *merging*, not replacing, with
 * the explicit `style` prop last — which is why the press transform below
 * survives alongside a call site's classes.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
cssInterop(AnimatedPressable, { className: "style" });

export type TouchableProps = PressableProps & {
  /** Which response this shape gets. Defaults to `chip` — the common case. */
  feel?: PressFeel;
  /**
   * What the press *means*, felt in the hardware. Omit for the many presses
   * that are only navigation: a phone that buzzes at everything is a phone
   * people turn the haptics off on, and then the moments that mattered are
   * gone with the rest.
   */
  haptic?: "tap" | "select" | "success" | "warning" | "error";
  /** Ripple without bounds — for a round icon button that has no background. */
  borderless?: boolean;
  className?: string;
};

export const Touchable = forwardRef<View, TouchableProps>(function Touchable(
  { feel = "chip", haptic, borderless, disabled, style, children, ...props },
  ref,
) {
  const { scheme, c } = useTheme();
  const press = useSharedValue(1);
  const lit = useSharedValue(0);

  const scaleTo = SCALE[feel];
  const scales = scaleTo !== 1;
  const lights = feel === "row";

  const anim = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const glow = useAnimatedStyle(() => ({ opacity: lit.value }));

  /**
   * Deliberately not the brand colour. A press is an acknowledgement, not a
   * state, and tinting every row green on touch would spend the brand on the
   * thing that happens most often and means least. A step along the neutral
   * ramp reads as "lit" without claiming anything.
   */
  const ripple = scheme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(26,26,24,0.07)";

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      // `foreground` so the ripple draws over the row's own background instead
      // of under it, where a filled surface would hide it completely. A
      // borderless ripple has no bounds to draw inside, so it can't be one.
      android_ripple={
        disabled ? undefined : { color: ripple, borderless: !!borderless, foreground: !borderless }
      }
      {...props}
      onPressIn={(e) => {
        if (!disabled) {
          if (scales) press.value = springTo(scaleTo, spring.quick);
          if (lights) lit.value = fadeTo(1, timing.quick);
          if (haptic) haptics[haptic]();
        }
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (scales) press.value = springTo(1, spring.base);
        // Slower out than in. The press has to register instantly and release
        // gently — that asymmetry is what makes a tap feel acknowledged rather
        // than merely detected.
        if (lights) lit.value = fadeTo(0, timing.base);
        props.onPressOut?.(e);
      }}
      style={scales ? [style, anim] : style}
    >
      {lights ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.surface2 },
              glow,
            ]}
          />
          {children as React.ReactNode}
        </>
      ) : (
        (children as React.ReactNode)
      )}
    </AnimatedPressable>
  );
});
