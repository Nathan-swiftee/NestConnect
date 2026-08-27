import { vars } from "nativewind";
import { colors, duration, fontSize, fontWeight, letterSpacing, lineHeight, radius, space } from "@ding/design/tokens";
import type { ThemeColors } from "@ding/design/tokens";
import { useAppearance } from "./appearance";

export { duration, fontSize, fontWeight, letterSpacing, lineHeight, radius, space };
export type { ThemeColors };

/** tokens.ts is camelCased; the CSS variables the Tailwind config reads use the
 *  CSS names. Converted once per scheme rather than on every render. */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
export const paletteVars = {
  light: vars(Object.fromEntries(Object.entries(colors.light).map(([k, v]) => [`--${kebab(k)}`, v]))),
  dark: vars(Object.fromEntries(Object.entries(colors.dark).map(([k, v]) => [`--${kebab(k)}`, v]))),
};

/**
 * The palette variables for the current scheme.
 *
 * The root layout publishes these once, and everything under it inherits — but
 * a React Native `Modal` renders into its own view hierarchy, outside that root.
 * Anything inside a Modal has to re-publish them or its colour utilities resolve
 * against nothing and it renders one theme's text on the other theme's ground.
 * Spread this onto the Modal's outermost child.
 */
export function useThemeVars() {
  return paletteVars[useAppearance().scheme];
}

/**
 * The palette for the scheme the app is currently in.
 *
 * "Currently in" rather than "the phone is in": this follows the appearance
 * preference, which defaults to the phone's but can be overridden in Settings.
 *
 * These are the same values the web reads from tokens.css — generated from it,
 * not re-typed. NativeWind covers most styling through `className`, but a few
 * places need a real colour value (a `StatusBar` style, a `RefreshControl`
 * tint, a shadow), and this is where those come from.
 */
export function useTheme(): { scheme: "light" | "dark"; c: ThemeColors } {
  const { scheme } = useAppearance();
  return { scheme, c: colors[scheme] };
}

/**
 * Elevation, expressed the way each platform actually wants it.
 *
 * tokens.css defines shadows as layered CSS strings, which React Native can't
 * express: iOS takes one offset/opacity/radius, Android takes a single
 * elevation number. So rather than pretend, these are the native reading of the
 * same three steps — near-invisible depth, not darkness.
 */
export const elevation = {
  card: { shadowColor: "#0D1512", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  sheet: { shadowColor: "#0D1512", shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  /**
   * Something small floating over a dimmed screen — the reaction pill above a
   * held message, and nothing else so far.
   *
   * Much heavier than `sheet`, on purpose. The other two sit on the page and
   * only need to separate from it; this one hangs in the middle of a scrim over
   * a backgrounded thread, and at `sheet`'s weight it reads as painted onto the
   * dim rather than lifted off it. The web overlay makes the same jump
   * (`0 14px 34px -10px rgba(0,0,0,.45)` on `.hold__react`).
   */
  float: { shadowColor: "#000000", shadowOpacity: 0.42, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 20 },
  /**
   * A panel rising from the bottom edge, casting *upward*.
   *
   * The offset is negative because the light in every other step comes from
   * above, and a sheet flush with the bottom of the screen has nothing below it
   * to catch a downward shadow — the only edge that can show depth is its top
   * one. Android ignores the direction (`elevation` is a single scalar), which
   * is fine: there it reads as a general lift, which is still the right answer.
   */
  lift: { shadowColor: "#000000", shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: -10 }, elevation: 16 },
  /**
   * A piece of chrome hovering just above the page — the floating tab bar.
   *
   * Between `card` and `sheet`, and closer to the page than either. It has to
   * lift a wide capsule off a background it nearly matches in colour, without
   * reading as a dialog: a `sheet`-weight shadow under something that never
   * moves makes the whole screen feel like a stack of cards, and `card` under
   * something this large disappears entirely. The offset is small because the
   * bar sits near the bottom edge, where a long drop has nowhere to fall.
   */
  bar: { shadowColor: "#0D1512", shadowOpacity: 0.13, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
} as const;
