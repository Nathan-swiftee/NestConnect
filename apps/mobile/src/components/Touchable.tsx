import { forwardRef } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
import { haptics } from "../haptics";

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
 *  - **Haptics**, by intent rather than intensity.
 *
 * ## What was taken back out
 *
 * Every visual press treatment, in three passes, because each one was reported
 * as cheap or annoying and each time the answer was to soften it rather than to
 * remove it.
 *
 * First `feel="row"` faded a full-bleed `surface2` panel in under the content
 * and took 220ms to fade out. Then the Android ripple was reshaped, because a
 * bounded foreground ripple is clipped to a view's *rectangular* bounds rather
 * than its rounded outline, so every round button flashed a grey rectangle with
 * corners outside the shape being pressed. Then it was made fainter. Then it
 * was reported again.
 *
 * So there is no press visual at all now — no ripple, no tint, no overlay. The
 * haptic is the acknowledgement, and it is the one that does not put a colour
 * over the thing being pressed.
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
  /**
   * **Inert.** It used to choose the ripple's bounds; there is no ripple now.
   *
   * Kept only because 86 call sites pass it, and editing 86 files to delete a
   * prop that costs nothing is a worse trade than a comment saying so. If a
   * press treatment ever comes back this is the seam it goes through — until
   * then, passing it changes nothing.
   */
  feel?: PressFeel;
  /**
   * What the press *means*, felt in the hardware. Omit for the many presses
   * that are only navigation: a phone that buzzes at everything is a phone
   * people turn the haptics off on, and then the moments that mattered are gone
   * with the rest.
   */
  haptic?: "tap" | "select" | "success" | "warning" | "error";
  /** **Inert**, for the same reason as `feel` — it chose the ripple's bounds. */
  borderless?: boolean;
  className?: string;
};

export const Touchable = forwardRef<View, TouchableProps>(function Touchable(
  { feel = "chip", haptic, borderless, disabled, children, ...props },
  ref,
) {

  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      /**
       * No `android_ripple`, and none of the tint that came before it.
       *
       * The grey wash Android draws on press was reported as cheap-looking
       * twice and annoying once, and each time the answer was to make it
       * fainter or reshape it rather than to take it out. It is out. What
       * remains is the haptic below, which is the feedback people actually
       * notice and the one that does not put a colour over the thing they are
       * pressing.
       *
       * The prop is gone entirely rather than set to `undefined`, because
       * `useAndroidRippleForView` routes a ripple to `nativeBackgroundAndroid`
       * whenever `foreground` is not true, and that *replaces* the view's
       * background drawable — which is how the emoji reaction pill silently
       * lost its white. There is nothing here to get that wrong now.
       */
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
