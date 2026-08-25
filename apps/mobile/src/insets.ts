import { useMemo } from "react";
import { Platform, StatusBar } from "react-native";
import { type EdgeInsets, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Pretend insets for verification, from `EXPO_PUBLIC_FAKE_INSETS="top,bottom"`.
 *
 * A browser has no status bar and no navigation bar, so the web export every
 * check runs against reports zero on all four edges — which is also what a
 * broken Android build reports. The two are indistinguishable, and that is
 * precisely how a chat header sat under the system clock through several
 * rounds of "verified at 390x844". Setting this to something like `40,24` makes
 * the export lay out as if it were on a phone with system bars, so a screen
 * that fails to inset fails the check instead of passing it.
 *
 * Read at module load: `EXPO_PUBLIC_` variables are inlined at build time, so
 * an unset one compiles to `undefined` and this is dead code in a real build.
 */
const FAKE = ((): EdgeInsets | null => {
  const raw: string | undefined = process.env.EXPO_PUBLIC_FAKE_INSETS;
  if (!raw) return null;
  const [top, bottom] = raw.split(",").map((n: string) => Number(n.trim()));
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  return { top, bottom, left: 0, right: 0 };
})();

/**
 * The safe-area insets, with a floor under the Android status bar.
 *
 * Every screen reads its top and bottom padding from here rather than calling
 * `useSafeAreaInsets` directly, because a zero from that hook is indistinguishable
 * from a phone that genuinely has no notch — and a zero we can't tell apart from a
 * real answer is how the chat header spent months underneath the clock.
 *
 * `StatusBar.currentHeight` is a second, independent source for the top: it's a
 * resource lookup on the Android side, not a WindowInsets dispatch, so it can't be
 * swallowed by a view in the middle of the tree the way the inset dispatch can. If
 * the two disagree we take the larger, which is the safe direction — too much
 * padding is a visible gap, too little is text under the system clock.
 *
 * There is no equivalent for the bottom. The navigation bar's height is only known
 * through the inset dispatch, so the composer still depends on that path being
 * healthy; the provider order in the root layout is what keeps it that way.
 */
export function useInsets(): EdgeInsets {
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    if (FAKE) return FAKE;
    if (Platform.OS !== "android") return insets;
    const statusBar = StatusBar.currentHeight ?? 0;
    return insets.top >= statusBar ? insets : { ...insets, top: statusBar };
  }, [insets]);
}
