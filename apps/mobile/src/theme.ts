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
} as const;
