import { useColorScheme } from "react-native";
import { colors, duration, fontSize, fontWeight, letterSpacing, lineHeight, radius, space } from "@ding/design/tokens";
import type { ThemeColors } from "@ding/design/tokens";

export { duration, fontSize, fontWeight, letterSpacing, lineHeight, radius, space };
export type { ThemeColors };

/**
 * The palette for the scheme the phone is currently in.
 *
 * These are the same values the web reads from tokens.css — generated from it,
 * not re-typed. NativeWind covers most styling through `className`, but a few
 * places need a real colour value (a `StatusBar` style, a `RefreshControl`
 * tint, a shadow), and this is where those come from.
 */
export function useTheme(): { scheme: "light" | "dark"; c: ThemeColors } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
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
