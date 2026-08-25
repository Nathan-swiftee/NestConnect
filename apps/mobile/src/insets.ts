import { useMemo } from "react";
import { Platform, StatusBar } from "react-native";
import Constants from "expo-constants";
import { type EdgeInsets, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";

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
 * The insets measured once at startup, before any of our React tree exists.
 *
 * This is the load-bearing fallback, and it's worth being precise about why.
 * `SafeAreaProvider` is *seeded* with these and then replaced by whatever the
 * native `onInsetsChange` dispatch reports. On Android that dispatch travels
 * down the view tree and a view in the middle can consume it — so a provider
 * that started with correct numbers can be overwritten with zeroes a frame
 * later, and `initialMetrics` on the provider does nothing to prevent it.
 *
 * Read straight from the module, these values never pass through the tree, so
 * nothing can eat them on the way. They're also the only second source we have
 * for the *bottom* edge; `StatusBar.currentHeight` only knows about the top.
 */
const AT_STARTUP = initialWindowMetrics?.insets;

/**
 * How tall the Android status bar is, according to whoever will admit to knowing.
 *
 * Two sources because neither is dependable alone. `StatusBar.currentHeight` is
 * a React Native constant that can arrive `undefined` on the New Architecture,
 * and `Constants.statusBarHeight` is Expo's own reading of the same thing. Both
 * are resource lookups rather than inset dispatches, which is the property that
 * matters: they cannot be consumed by a view further up the tree.
 */
const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? Math.max(StatusBar.currentHeight ?? 0, Constants.statusBarHeight ?? 0) : 0;

/**
 * The safe-area insets, taken as the largest value any source will vouch for.
 *
 * Every screen reads its padding from here rather than calling
 * `useSafeAreaInsets` directly, because a zero from that hook is
 * indistinguishable from a phone that genuinely has no notch — and a zero we
 * can't tell apart from a real answer is how the chat header spent months
 * underneath the clock and the composer underneath the navigation bar.
 *
 * Taking the maximum is deliberate and the errors are not symmetric: too much
 * padding is a visible gap someone reports, too little puts text under the
 * system clock where it reads as a broken app. Nothing here reports *more* than
 * the true inset, so the maximum is the true inset as soon as any one source is
 * working.
 */
/**
 * What each source claims, for the diagnostic line in Settings.
 *
 * When a device disagrees with every check we can run off-device, the useful
 * thing is not "the padding is wrong" but *which* of these came back zero —
 * that names the broken link without another round of guessing.
 */
export const INSET_SOURCES = { atStartup: AT_STARTUP, androidStatusBar: ANDROID_STATUS_BAR };

export function useInsets(): EdgeInsets {
  const live = useSafeAreaInsets();
  return useMemo(() => {
    if (FAKE) return FAKE;
    const top = Math.max(live.top, AT_STARTUP?.top ?? 0, ANDROID_STATUS_BAR);
    const bottom = Math.max(live.bottom, AT_STARTUP?.bottom ?? 0);
    const left = Math.max(live.left, AT_STARTUP?.left ?? 0);
    const right = Math.max(live.right, AT_STARTUP?.right ?? 0);
    // Keep the identity stable when nothing beats the live values — these feed
    // memoised rows, and a fresh object every render defeats the memo.
    if (top === live.top && bottom === live.bottom && left === live.left && right === live.right) return live;
    return { top, bottom, left, right };
  }, [live]);
}
