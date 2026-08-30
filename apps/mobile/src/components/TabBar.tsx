import { useEffect, useState, type RefObject } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs/types";
import { haptics } from "../haptics";
import { useInsets } from "../insets";
import { spring, springTo } from "../motion";
import { useTheme } from "../theme";

/**
 * The bottom navigation: a floating capsule with a pill that travels.
 *
 * Shaped after WhatsApp's, which is the reference everyone on this product
 * already has in their pocket. Two things make that bar read the way it does,
 * and neither is the icons:
 *
 *  1. **It floats.** The bar is a rounded capsule inset from the screen edges,
 *     not a slab welded to the bottom with a hairline on top. A capsule reads
 *     as a control you operate; a slab reads as the edge of the window. What
 *     separates it from the page is a hairline ring and the blur behind it —
 *     not a drop shadow, which cannot coexist with real glass; see the capsule
 *     itself for why.
 *  2. **The selection is behind the icon, not the whole item.** A neutral pill
 *     sits under the glyph and the label stays outside it, which keeps the
 *     label legible and stops the selection from looking like a button.
 *
 * The pill is ours. The stock tab bar recolours the selected item and nothing
 * else, so switching tabs is a cut: one icon goes grey, another goes green, and
 * the eye has to find the change. Here the pill slides from the old tab to the
 * new one, which does two things a colour swap can't — it says *where you came
 * from*, and it gives the tap something to land on.
 *
 * How it moves is the whole point, so it's worth saying what it isn't. The pill
 * doesn't fade out and in at the destination (that's a cut with extra steps),
 * and it doesn't slide at a constant speed (that's a slideshow). One spring
 * carries a single `progress` value from the old index to the new one, and both
 * the pill's position and its width are read off that — so on a jump from Inbox
 * to Settings it passes over the tabs in between rather than teleporting past
 * them.
 *
 * The stretch is what makes it read as liquid rather than as a rectangle being
 * moved. Mid-flight the pill is wider than it is at either end, and it settles
 * back as it arrives; the amount is derived from how far `progress` sits from a
 * whole number, so it's zero at rest by construction and needs no separate
 * animation to keep in sync with the travel.
 *
 * The capsule **overlays** the screen, so the list passes behind it rather than
 * stopping on top of it. That is most of why the reference reads as floating,
 * and it can't be faked by a bar that sits in the layout — with nothing behind
 * it there is nothing for it to float over.
 *
 * The cost is that nothing reserves the bar's space any more, so a screen that
 * scrolls has to end its content above it. That is exactly the failure this app
 * has already shipped twice — the chat header under the clock, the composer
 * under the system bar — so the height is a single exported constant,
 * {@link TAB_BAR_H}, and every tab screen adds that same number rather than
 * each picking its own and drifting.
 *
 * ---
 *
 * Everything here is styled with plain `style` objects rather than `className`.
 * That's deliberate and it's the one place in the app that does it: NativeWind's
 * interop replaces a registered component and spreads its own computed props
 * over the ones the call site passed, which has already cost us a day on a
 * layout that behaved in a browser and not on a phone. A navigation bar that
 * mis-lays-out is a navigation bar you can't use to get anywhere else, so this
 * file takes the boring path.
 */

/** The pill's box. Wide enough to sit under the icon with air around it. */
const PILL_W = 54;
const PILL_H = 30;

/** Extra width, as a fraction, at the midpoint of a one-tab hop. */
const STRETCH = 0.24;

/** How far the capsule is held off the screen's left and right edges. */
const INSET = 12;
/** The capsule's own padding, inside which the tabs and the pill sit. */
const PAD_X = 6;
const PAD_Y = 5;

const ICON = 21;
/**
 * The label's line box, pinned rather than left to the font.
 *
 * This is the fix for the icons visibly jumping as you switched tabs, and it is
 * an Android-only fault that no amount of looking at it in a browser would have
 * found — every position measures identical on react-native-web. On Android a
 * numeric `fontWeight` selects a different *font file* (Roboto Medium vs
 * Roboto Bold), and two files have two sets of ascent/descent metrics, so
 * bolding the selected label made its line box a little taller. That grew the
 * item, which grew the capsule, which — being anchored to the bottom — pushed
 * every icon in the bar up by a pixel or two and dropped them again on the way
 * back. An explicit `lineHeight` gives the text the same box in either weight,
 * so the bar's height is now a constant of the layout rather than a property of
 * whichever font Android reached for.
 */
const LABEL_SIZE = 10;
const LABEL_LINE = 12;
/**
 * Between the icon's box and the label — zero, because the line box already
 * carries 2pt of leading above the glyphs at this size, and in the reference
 * the label sits directly under its icon as one object rather than as a caption
 * beneath one.
 */
const LABEL_GAP = 0;

/**
 * What the blur radius is divided by on Android, and why it is the library's
 * default rather than a number of ours.
 *
 * The radius reaching the native blur is `intensity / blurReductionFactor`, and
 * on the RenderScript path `ScriptIntrinsicBlur.setRadius` accepts `0 < r <= 25`
 * and throws otherwise. This was set to 2 to get a softer blur — which was
 * harmless for exactly as long as the blur was not running, because the target
 * had never been registered and the native view had quietly fallen back to
 * `NONE`. The build that finally wired the target up therefore ran the radius
 * for the first time, at 70 / 2 = 35, and the app crashed on launch.
 *
 * At 4, the largest radius this can ever produce is 100 / 4 = 25 — the cap
 * exactly. Softness comes from `blurMethod` and the wash instead, neither of
 * which can throw.
 */
const BLUR_REDUCTION = 4;

/**
 * The capsule's corner.
 *
 * Past half the capsule's height, so both platforms clamp it to a fully round
 * end — the shape in the reference. A fixed number rather than a computed
 * half-height because the height isn't known until layout, and turning Dynamic
 * Type up should soften the ends rather than break the radius.
 */
const CAPSULE_R = 30;

/** The capsule's height, and so the room a screen owes it. See {@link TAB_BAR_H}. */
const CAPSULE_H = PAD_Y * 2 + PILL_H + LABEL_GAP + LABEL_LINE;

/**
 * How much bottom room a tab screen has to leave for the bar.
 *
 * The bar overlays the screen so content passes behind it, which is what makes
 * it read as floating rather than as a shelf the page sits on. The cost of that
 * is this number: a screen that scrolls has to end its content above the bar
 * itself, because nothing reserves the space any more. Exported so the screens
 * add the same figure the bar is actually drawn at instead of each guessing.
 *
 * The safe-area inset is *not* included — a screen adds that itself, as it
 * already did before the bar floated.
 */
export const TAB_BAR_H = CAPSULE_H + 10;

export function TabBar({
  state,
  descriptors,
  navigation,
  blurTarget,
}: BottomTabBarProps & {
  /**
   * The subtree the glass is a picture of, from `(tabs)/_layout.tsx`.
   *
   * Android's blur is not ambient: it captures a nominated view and, given
   * none, `ExpoBlurView` sets its method to `NONE` without saying so. Optional
   * only because iOS ignores it entirely.
   */
  blurTarget?: RefObject<View | null>;
}) {
  const { scheme } = useTheme();
  const insets = useInsets();

  // Only the routes that actually appear, and their own dense numbering.
  //
  // The two differ, and the pill has to travel in the second. Not every route
  // in the navigator's state is a tab: expo-router says which are withheld by
  // stamping `tabBarItemStyle: { display: "none" }`, and it does that in two
  // places — for `href: null` (how Insights is kept from agents) and for its
  // own generated screens (`_sitemap`, `+not-found`), which would otherwise
  // show up here as tabs named after their files.
  //
  // Numbering by the navigator's index instead would leave holes: with Insights
  // withheld, a hop from Customers to Settings passes through an index that was
  // never measured, and the pill blinks out halfway across.
  const shown = state.routes.filter(
    (route) => StyleSheet.flatten(descriptors[route.key].options.tabBarItemStyle)?.display !== "none",
  );
  // -1 while the focused route isn't a tab at all — reachable by deep link, e.g.
  // an agent opening /insights directly. Nothing to point at, so nothing shows.
  const active = shown.findIndex((route) => route.key === state.routes[state.index]?.key);

  // Where the pill is, in visible-tab units. Fractional while travelling, which
  // is what lets position, width and stretch all be read off one value.
  const progress = useSharedValue(Math.max(0, active));

  /**
   * Where each tab's centre is, computed rather than measured.
   *
   * This used to be a handshake: every tab reported its frame through
   * `onLayout` into a `slots` shared value, and a second shared value held the
   * pill at `opacity: 0` until at least two of them had arrived. Rendering the
   * bar through the native path showed what that cost — the pill came out with
   * its full box and colour and `opacity: 0`. Both its visibility *and* its
   * position hung on a four-way measurement crossing the JS/UI thread boundary,
   * and when that didn't complete the pill was invisible **and** parked at x=0.
   * Which is also why the glide has never been seen: there was nothing to
   * glide.
   *
   * None of it was necessary. The tabs are `flex: 1` in a row of known width,
   * so every centre is arithmetic. `left: 0` on an absolute child resolves
   * against the row's padding box — its outer edge — so the row's own
   * `paddingHorizontal` has to be added back.
   *
   * `measured` is a correction, not a gate: the computed width is used from the
   * first frame and only replaced if the row ever reports something different.
   */
  // The focused route isn't one of the tabs — reachable by deep link, e.g. an
  // agent opening /insights directly. Nothing to point at.
  const hidden = active < 0;
  const { width: screenW } = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const rowW = measured || screenW - INSET * 2 - StyleSheet.hairlineWidth * 2;
  const count = Math.max(1, shown.length);
  const slotW = (rowW - PAD_X * 2) / count;
  useEffect(() => {
    if (active < 0) return;
    // `settle`, not `base`. The travel is the thing being looked at, and at
    // the default stiffness it was over in about 200ms — technically a glide,
    // in practice a cut. Softer covers the same distance in half again the
    // time, which is long enough to actually watch the pill leave one tab and
    // arrive at the next, and it keeps the mid-flight stretch on screen instead
    // of flashing past. Still essentially critically damped (ζ ≈ 0.89), so it
    // arrives without a wobble.
    progress.value = springTo(active, spring.settle);
  }, [active, progress]);

  /**
   * The pill's fixed geometry, spread into the animated style below.
   *
   * It reads as a static style and it used to be written as one, in an array
   * beside `pill` — which is the shape that never arrives. The pill therefore
   * had no width, no height, no radius and, most visibly, no background: the
   * selected tab has been unmarked on the device this whole time. The travel
   * animation was running perfectly on something invisible.
   *
   * The old note here argued that a constant `width` belongs in a static style
   * so Android isn't asked to lay the pill out sixty times a second. The
   * concern was reasonable and the conclusion was wrong, because there is no
   * static style to put it in. It costs nothing in practice: these values never
   * change, so the shadow-tree diff sees the same numbers every frame and
   * nothing is re-laid out. Only `translateX` and `scaleX` actually move, and
   * both are compositor-only.
   */
  const BOX = {
    position: "absolute" as const,
    top: PAD_Y,
    left: 0,
    width: PILL_W,
    height: PILL_H,
    borderRadius: PILL_H / 2,
    // Neutral, as in the reference — but heavier than the palette's `surface2`,
    // which at 5% black on a white capsule was so close to invisible on a real
    // screen in daylight that the travel it exists to show read as nothing
    // moving at all. This is the one value in the file tuned to the surface it
    // sits on rather than taken from the tokens, for the same reason PILL_W is.
    backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.13)" : "rgba(26,26,24,0.085)",
  };

  const pill = useAnimatedStyle(() => {
    // Nothing to point at: the focused route isn't one of the tabs, reachable
    // by deep link. This is the *only* thing that hides the pill now. An
    // opacity that waited on anything — a measurement, an effect, a shared
    // value being filled in — is what made it invisible before, and the first
    // attempt at this fix moved that wait into a `useEffect` rather than
    // removing it. `slotW` and `count` are plain values from the render scope,
    // so the worklet has them the moment it exists.
    if (hidden) return { ...BOX, opacity: 0 };

    const i = Math.min(Math.max(progress.value, 0), count - 1);
    // Interpolating the index and then converting to a position, rather than
    // interpolating between two positions: the tabs are evenly spaced, so the
    // two are identical, and this needs no table to look anything up in.
    const cx = PAD_X + slotW * (i + 0.5);
    // Distance from the nearest tab, 0 at rest and 0.5 mid-hop. Doubling it
    // makes the stretch peak at exactly the halfway point of any single hop —
    // and on a two-tab jump it peaks twice, passing through each tab it crosses,
    // which is the right read: it's slowing over each one on its way past.
    const away = Math.abs(i - Math.round(i)) * 2;

    return {
      ...BOX,
      opacity: 1,
      transform: [{ translateX: cx - PILL_W / 2 }, { scaleX: 1 + away * STRETCH }],
    };
  });

  return (
    <View
      // Out of flow, pinned to the bottom, and transparent — the screen runs the
      // full height of the navigator and its content scrolls underneath.
      // `pointerEvents="box-none"` on the wrapper is what keeps the transparent
      // margin either side of the capsule from swallowing taps meant for the
      // list behind it.
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: INSET,
        // The bar's height is whatever its contents come to, so Dynamic Type is
        // handled by construction: turn text size up and the labels take the
        // room they need instead of losing their descenders to a fixed height.
        // (React Navigation's own bar pins the label size on iOS to dodge this;
        // we can afford the honest version.) `maxFontSizeMultiplier` on the
        // label caps the growth before the bar starts eating the inbox it
        // exists to navigate.
        //
        // The floor of 8 is for a device with no home indicator, where the
        // inset is 0 and the capsule would otherwise sit hard against the glass.
        paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
        paddingTop: 0,
      }}
      testID="tabbar"
      accessibilityRole="tablist"
    >
      {/* Nothing opaque anywhere in here, and that is the whole trick.

          The capsule used to carry `backgroundColor: c.surface` — solid white —
          on the theory that Android needs a colour under an elevation or it
          draws no shadow, and that the blur would cover it anyway. A blur does
          not cover what is behind it; it is a *photograph* of it. So the glass
          was a photograph of a white rectangle, and no amount of tuning
          intensity or tint was ever going to make that look like glass.

          The elevation went with it, because the two cannot coexist: an Android
          shadow is cast from the view's outline, an outline comes from its
          background, and any background here is the thing the blur will show
          you instead of your inbox. The hairline ring does the separating now,
          which is what draws the edge on a real glass panel anyway. */}
      <View
        testID="tabbar-capsule"
        style={{
          borderRadius: CAPSULE_R,
          // Carrying the whole job of separating the capsule from the page now,
          // so it is a touch stronger than when it was helping a shadow.
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: scheme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(26,26,24,0.12)",
        }}
      >
        <BlurView
          // Frosted, not merely see-through. Without a blur a translucent bar
          // over a moving list is worse than an opaque one — you read the text
          // sliding through it. The blur is what turns "you can see there is
          // content down there" into "you can't read it", which is the whole
          // point of the material.
          //
          // `Sdk31Plus`, not plain `dimezisBlurView`. The plain method uses
          // RenderScript on every Android version, and `ScriptIntrinsicBlur`
          // throws outright above a radius of 25 — see `BLUR_REDUCTION`. On
          // Android 12 and up this uses `RenderEffect` instead, which has no
          // such ceiling and is the path Android itself is moving to;
          // RenderScript has been deprecated since 12 and dropped from the
          // modern NDK. Below 12 it degrades to no blur, which is a worse bar
          // but a bar that exists.
          blurMethod="dimezisBlurViewSdk31Plus"
          // The subtree to photograph. Android has no ambient blur: without
          // this the native view sets its method to `NONE` and renders a plain
          // panel, silently. See `(tabs)/_layout.tsx`.
          blurTarget={blurTarget}
          blurReductionFactor={BLUR_REDUCTION}
          // Kept so that `intensity / BLUR_REDUCTION` stays well inside 25 on
          // any path. Every earlier value here — 44, 60, 84, 48, 70 — was
          // chosen by looking at a bar that had no blur running behind it, so
          // each was really a guess about how white to make an opaque panel.
          intensity={scheme === "dark" ? 52 : 60}
          tint={scheme === "dark" ? "dark" : "light"}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: CAPSULE_R, overflow: "hidden" },
          ]}
        />
        {/* A wash over the blur — over, so it is never photographed by it.
            Blur alone takes its value from whatever happens to be underneath,
            so a dark photo scrolling past would drag the whole bar dark and
            take the labels with it; this holds the contrast steady.

            It has been 0.55, 0.30 and 0.18, and none of those were really
            decisions: the bar looked white because no blur was running, so
            every value was compensating for the wrong thing — first by adding
            white to a white panel, then by taking so much away that the bar
            became a window you could read straight through. With the blur
            running it does its own job, which is to keep a `textMuted` label
            legible when something dark scrolls underneath. */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: CAPSULE_R,
              backgroundColor:
                scheme === "dark" ? "rgba(21,21,20,0.32)" : "rgba(255,255,255,0.34)",
            },
          ]}
        />
        <View
          // The one measurement left, and it corrects rather than gates: the
          // pill is already drawn from the computed width by the time this
          // arrives, and this only matters if the two ever disagree.
          onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            paddingHorizontal: PAD_X,
            paddingVertical: PAD_Y,
          }}
        >
        {/* Behind the items, not between them: a tap has to reach the tab, and
            an absolutely-positioned sibling with no `pointerEvents` would sit in
            front of the row and swallow every press near the middle. */}
        {/* `pill` and nothing else — it carries BOX; see where it is built. */}
        <Animated.View pointerEvents="none" testID="tabbar-pill" style={pill} />

        {shown.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : options.title ?? route.name;
          const focused = index === active;

          return (
            <TabItem
              key={route.key}
              label={label}
              focused={focused}
              icon={options.tabBarIcon}
              testID={options.tabBarButtonTestID ?? `tab-${route.name}`}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (event.defaultPrevented) return;
                if (focused) {
                  // Re-tapping the tab you're on is "go to the top of this
                  // section", which the navigator handles. No pill to move and
                  // no buzz — nothing navigated.
                  navigation.navigate(route.name, route.params);
                  return;
                }
                haptics.tap();
                navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => {
                navigation.emit({ type: "tabLongPress", target: route.key });
              }}
            />
          );
        })}
        </View>
      </View>
    </View>
  );
}

/**
 * One destination.
 *
 * The icon is two copies stacked — muted underneath, brand on top — and the
 * selection cross-fades between them. Animating the colour of an SVG means an
 * animated component per path and a prop the icon set doesn't take; two views
 * and an opacity gets the identical result for a rounding error's worth of
 * memory, and it stays in step with the pill because both are springs of the
 * same family.
 */
function TabItem({
  label,
  focused,
  icon,
  testID,
  onPress,
  onLongPress,
}: {
  label: string;
  focused: boolean;
  icon?: (props: { focused: boolean; color: string; size: number }) => React.ReactNode;
  testID?: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { c } = useTheme();
  const on = useSharedValue(focused ? 1 : 0);
  const press = useSharedValue(1);

  useEffect(() => {
    // The same spring as the pill's travel, so the icon and label change hands
    // *with* it rather than finishing early and leaving the pill to catch up.
    on.value = springTo(focused ? 1 : 0, spring.settle);
  }, [focused, on]);

  // The whole item shrinks under the thumb — the pill is behind the icon, so
  // dimming the icon alone would look like it had gone unavailable.
  // The alignment lives in these two rather than in a style object beside them.
  // An animated style is the only style that reaches an element on this stack,
  // so `style={[{ alignItems: "center" }, squeeze]}` arrives as `squeeze` alone
  // and the icon and its label stop being centred on each other.
  const squeeze = useAnimatedStyle(() => ({
    alignItems: "center",
    transform: [{ scale: press.value }],
  }));

  const active = useAnimatedStyle(() => ({
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: on.value,
    // A hair larger when selected. Not enough to notice as growth — enough that
    // the selected tab has slightly more presence than its neighbours.
    transform: [{ scale: interpolate(on.value, [0, 1], [0.94, 1]) }],
  }));
  const idle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));

  /**
   * The label: type as well as colour, in one object.
   *
   * All of the type below used to sit in a static style beside this one, and
   * none of it reached the device — the labels rendered at React Native's
   * default 14pt, default weight, hard against the icon. "The text can be
   * smaller and closer to the icon" was this: the values were already 10.5 and
   * a 1pt gap, they were simply being discarded.
   */
  const text = useAnimatedStyle(() => ({
    fontSize: LABEL_SIZE,
    // Pinned, so the two font files Android picks for these two weights can't
    // hand back two different line boxes. See the note on LABEL_LINE — this one
    // line is the whole of the icons-jumping fix, and it has to stay whatever
    // else changes here.
    lineHeight: LABEL_LINE,
    // Weight, not just colour. The reference leans on it hard, and it survives
    // where colour doesn't — a green label and a grey one are the same label to
    // anyone who can't separate the two hues. Switched rather than animated:
    // React Native can't interpolate a font weight, and at this size the change
    // reads as the label sharpening rather than as a jump. The item is centred
    // in a flexed cell, so the extra width moves nothing but itself.
    fontWeight: focused ? ("700" as const) : ("500" as const),
    marginTop: LABEL_GAP,
    // A tab label is a name, not a sentence: on a narrow phone with large text
    // "Customers" would otherwise be squeezed into the neighbouring tabs' space
    // rather than shrinking within its own.
    paddingHorizontal: 2,
    // From muted, not faint. In the reference every label is readable and the
    // selected one is merely *more* so — faint labels turn the four
    // destinations into one green word and three grey smudges, which is a
    // worse map of the app than no labels at all.
    color: interpolateColor(on.value, [0, 1], [c.textMuted, c.brandStrong]),
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        press.value = springTo(0.9, spring.quick);
      }}
      onPressOut={() => {
        press.value = springTo(1, spring.quick);
      }}
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      // Android's ripple is a rectangle in a bar made of round shapes, and it
      // fights the pill it lands on top of. The scale is the feedback.
      android_ripple={undefined}
      style={{ flex: 1, alignItems: "center" }}
    >
      <Animated.View style={squeeze}>
        <View style={{ height: PILL_H, justifyContent: "center", alignItems: "center" }}>
          {/* Muted rather than faint, to match the label above it and the
              reference: an unselected destination is still a destination, and
              at `faint` the three you aren't on fade into the capsule. */}
          <Animated.View style={idle}>{icon?.({ focused: false, color: c.textMuted, size: ICON })}</Animated.View>
          <Animated.View style={active}>
            {icon?.({ focused: true, color: c.brandStrong, size: ICON })}
          </Animated.View>
        </View>
        <Animated.Text
          numberOfLines={1}
          // Dynamic Type is honoured — the bar's height is computed from the
          // same scale, so the label has room rather than being clipped.
          maxFontSizeMultiplier={1.6}
          // `text` alone — it carries the type as well as the colour; see where
          // it is built.
          style={text}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}
