import { forwardRef } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { timing, fadeTo } from "../motion";
import { haptics } from "../haptics";
import { useTheme } from "../theme";

/**
 * Everything in the app you can press.
 *
 * The app had 86 pressables and 76 of them gave the same feedback: a NativeWind
 * `active:opacity-*` class — a binary opacity flip with no easing and, on
 * Android, no ripple. That one default was the biggest single reason the app
 * read as a web page in a native shell.
 *
 * ## Why this is a plain `Pressable`
 *
 * The first version of this component rendered
 * `Animated.createAnimatedComponent(Pressable)` registered with `cssInterop`,
 * so the press could spring a scale while `className` still worked. It passed
 * every check in a browser and broke the app on the device: the compose button
 * lost its green disc, and every `style` prop on a `Touchable` was silently
 * dropped.
 *
 * The cause is that `react-native-css-interop` **already registers
 * `Pressable`** (`runtime/components.js`). So that version ran the interop
 * twice: the outer registration computed a style from `className` and handed it
 * to Reanimated's wrapper, which rendered the raw `Pressable` — which the JSX
 * runtime substituted *again* with the pre-registered interop Pressable, this
 * time holding a `style` and no `className`. The second pass overwrote the
 * first, and the caller's inline `style` went with it.
 *
 * So: a plain `Pressable`, which is exactly what all 76 call sites rendered
 * before, and therefore styles exactly as they did before. What is added is the
 * part that needed no animation to be worth having:
 *
 *  - **A real Android ripple**, on every pressable rather than the one that had
 *    it. It is the platform's own answer to "was that press received", and its
 *    absence is something Android users notice without being able to name.
 *  - **A highlight on full-bleed rows.** A list row that shrinks under the
 *    finger is a web-app tell; a native row lights up, so `feel="row"` fades a
 *    surface tint in behind the content. This is a child with a `style` and no
 *    `className`, so there is nothing for an interop to overwrite.
 *  - **Haptics**, by intent rather than intensity.
 *
 * The press *scale* that `chip` and `slab` used to carry is deliberately not
 * here yet. It needs an animated component, animated components need care
 * around the interop, and that is not something to guess at twice — it comes
 * back when it can be checked on a device rather than in a browser.
 */

export type PressFeel = "chip" | "slab" | "row" | "none";

export type TouchableProps = PressableProps & {
  /** Which response this shape gets. `row` is the only one that changes what is
   *  rendered; the rest differ only in ripple bounds. */
  feel?: PressFeel;
  /**
   * What the press *means*, felt in the hardware. Omit for the many presses
   * that are only navigation: a phone that buzzes at everything is a phone
   * people turn the haptics off on, and then the moments that mattered are gone
   * with the rest.
   */
  haptic?: "tap" | "select" | "success" | "warning" | "error";
  /** Ripple without bounds — for a round icon button that has no background. */
  borderless?: boolean;
  className?: string;
};

export const Touchable = forwardRef<View, TouchableProps>(function Touchable(
  { feel = "chip", haptic, borderless, disabled, children, ...props },
  ref,
) {
  const { scheme, c } = useTheme();
  const lit = useSharedValue(0);
  const lights = feel === "row";
  const glow = useAnimatedStyle(() => ({ opacity: lit.value }));

  /**
   * Deliberately not the brand colour. A press is an acknowledgement, not a
   * state, and tinting every row green on touch would spend the brand on the
   * thing that happens most often and means least.
   */
  const ripple = scheme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(26,26,24,0.07)";

  return (
    <Pressable
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
          if (lights) lit.value = fadeTo(1, timing.quick);
          if (haptic) haptics[haptic]();
        }
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // Slower out than in. The press has to register instantly and release
        // gently — that asymmetry is what makes a tap feel acknowledged rather
        // than merely detected.
        if (lights) lit.value = fadeTo(0, timing.base);
        props.onPressOut?.(e);
      }}
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
    </Pressable>
  );
});
