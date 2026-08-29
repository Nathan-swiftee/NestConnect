import { forwardRef } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
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
 *  - **Haptics**, by intent rather than intensity.
 *
 * ## What was taken back out
 *
 * `feel="row"` used to fade a full-bleed `surface2` panel in under the content
 * on press and take 220ms to fade it back out. Together with a bounded ripple
 * that drew a grey rectangle over every rounded shape (see `bounded` below),
 * that is what "every button has this grey background that gets activated for a
 * second — remove it, it's cheap" was about. Both are gone. `feel` now decides
 * only the ripple's shape.
 *
 * The press *scale* that `chip` and `slab` once carried is still not here. It
 * needs the whole button — background included — inside an animated element,
 * which on this stack means a wrapper node around all 86 call sites, and a
 * wrapper changes how a flexed `Touchable` measures. That is a real layout risk
 * for a polish feature, so it stays out until it can be done call-site by call
 * site rather than all at once.
 */

export type PressFeel = "chip" | "slab" | "row" | "none";

export type TouchableProps = PressableProps & {
  /** What shape this is, which decides the ripple's bounds. `row` is the only
   *  rectangular one; see `bounded`. */
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
  const { scheme } = useTheme();

  /**
   * The ripple goes in the **foreground** unless the caller asked for a
   * borderless one, and that is not a stylistic choice.
   *
   * `useAndroidRippleForView` sends a ripple to `nativeBackgroundAndroid`
   * whenever `foreground` isn't true — and `nativeBackgroundAndroid` *replaces*
   * the view's background drawable. Every `Touchable` carrying a
   * `backgroundColor` loses it.
   *
   * That is what happened when this tried to fix a different problem: bounded
   * foreground ripples are clipped to the view's rectangular bounds rather than
   * its rounded outline, so round buttons flashed a grey rectangle. Sending
   * them borderless instead did stop the rectangle — and silently erased the
   * background of every chip in the app, which is how the emoji reaction pill
   * lost its white and became two glyphs floating over their own shadow.
   *
   * So `borderless` stays what it always was: an explicit opt-in from a call
   * site that knows it has no background to lose. The rectangle is addressed by
   * the ripple being much fainter than it was, not by moving it.
   */
  const ripple = scheme === "dark" ? "rgba(255,255,255,0.07)" : "rgba(26,26,24,0.05)";

  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      android_ripple={
        disabled ? undefined : { color: ripple, borderless: !!borderless, foreground: !borderless }
      }
      {...props}
      onPressIn={(e) => {
        if (!disabled && haptic) haptics[haptic]();
        props.onPressIn?.(e);
      }}
    >
      {children as React.ReactNode}
    </Pressable>
  );
});
