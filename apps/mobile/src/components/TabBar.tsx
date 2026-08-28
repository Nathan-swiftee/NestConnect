import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutRectangle } from "react-native";
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
import { fadeTo, spring, springTo, timing } from "../motion";
import { elevation, useTheme } from "../theme";

/**
 * The bottom navigation: a floating capsule with a pill that travels.
 *
 * Shaped after WhatsApp's, which is the reference everyone on this product
 * already has in their pocket. Two things make that bar read the way it does,
 * and neither is the icons:
 *
 *  1. **It floats.** The bar is a rounded capsule inset from the screen edges
 *     with a shadow under it, not a slab welded to the bottom with a hairline
 *     on top. A capsule reads as a control you operate; a slab reads as the
 *     edge of the window.
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
const LABEL_SIZE = 10.5;
const LABEL_LINE = 13;
/** Between the icon's box and the label. */
const LABEL_GAP = 1;

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

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { c, scheme } = useTheme();
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
  // Each tab's measured frame, keyed by its position in `shown`. A shared value
  // rather than state because the pill's style reads it on the UI thread every
  // frame.
  const slots = useSharedValue<Record<number, LayoutRectangle>>({});
  // Suppressed until at least two tabs have reported their frames — otherwise
  // the pill paints at x=0 on the first frame and visibly jumps into place.
  const ready = useSharedValue(0);

  useEffect(() => {
    if (active < 0) {
      ready.value = fadeTo(0, timing.quick);
      return;
    }
    // `settle`, not `base`. The travel is the thing being looked at, and at
    // the default stiffness it was over in about 200ms — technically a glide,
    // in practice a cut. Softer covers the same distance in half again the
    // time, which is long enough to actually watch the pill leave one tab and
    // arrive at the next, and it keeps the mid-flight stretch on screen instead
    // of flashing past. Still essentially critically damped (ζ ≈ 0.89), so it
    // arrives without a wobble.
    progress.value = springTo(active, spring.settle);
  }, [active, progress, ready]);

  const pill = useAnimatedStyle(() => {
    const i = progress.value;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    const a = slots.value[lo];
    const b = slots.value[hi] ?? a;
    if (!a || !b) return { opacity: 0 };

    const t = i - lo;
    const cx = a.x + a.width / 2 + (b.x + b.width / 2 - (a.x + a.width / 2)) * t;
    // Distance from the nearest tab, 0 at rest and 0.5 mid-hop. Doubling it
    // makes the stretch peak at exactly the halfway point of any single hop —
    // and on a two-tab jump it peaks twice, passing through each tab it crosses,
    // which is the right read: it's slowing over each one on its way past.
    const away = Math.abs(i - Math.round(i)) * 2;

    // Opacity and transform only. `width` is a constant and belongs in the
    // static style: a width in an animated style is a layout property being
    // re-applied every frame, which on Android means the pill is laid out again
    // sixty times a second instead of just being moved by the compositor.
    return {
      opacity: ready.value,
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
      {/* The capsule is two views, and it has to be.
          
          `BlurView` samples what is behind it, so it can't also be the thing
          that clips and shadows itself: `overflow: hidden` is what rounds the
          blur to the capsule's shape, and on Android a view that clips its
          children cannot also cast an elevation shadow. So the outer view owns
          the shadow and the shape, the inner blur fills it, and the row sits on
          top of both. */}
      <View
        testID="tabbar-capsule"
        style={{
          borderRadius: CAPSULE_R,
          // The ring is doing real work in dark mode, where the capsule and the
          // page behind it are close enough in value that the shadow alone
          // doesn't separate them. On glass it does a second job: it draws the
          // edge, which is what stops a translucent panel from reading as a
          // smudge.
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: scheme === "dark" ? "rgba(255,255,255,0.10)" : c.border,
          ...elevation.bar,
          // Android needs a colour under the elevation or it draws no shadow at
          // all; the blur covers it, so this is never seen.
          backgroundColor: c.surface,
        }}
      >
        <BlurView
          // Frosted, not merely see-through. Without a blur a translucent bar
          // over a moving list is worse than an opaque one — you read the text
          // sliding through it. The blur is what turns "you can see there is
          // content down there" into "you can't read it", which is the whole
          // point of the material.
          //
          // `dimezisBlurView` is the only Android path that actually samples the
          // view behind it; the default there is a flat tint that looks like a
          // bug next to iOS.
          experimentalBlurMethod="dimezisBlurView"
          intensity={scheme === "dark" ? 44 : 60}
          tint={scheme === "dark" ? "dark" : "light"}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: CAPSULE_R, overflow: "hidden" },
          ]}
        />
        {/* A wash over the blur. Blur alone takes its value from whatever
            happens to be underneath, so a dark photo scrolling past would drag
            the whole bar dark and take the labels with it; this holds the
            contrast steady while still letting the movement through. */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: CAPSULE_R,
              backgroundColor:
                scheme === "dark" ? "rgba(21,21,20,0.55)" : "rgba(255,255,255,0.55)",
            },
          ]}
        />
        <View
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
        <Animated.View
          pointerEvents="none"
          testID="tabbar-pill"
          style={[
            {
              position: "absolute",
              top: PAD_Y,
              left: 0,
              width: PILL_W,
              height: PILL_H,
              borderRadius: PILL_H / 2,
              // Neutral, as in the reference — but heavier than the palette's
              // `surface2`, which at 5% black on a white capsule was so close
              // to invisible on a real screen in daylight that the travel it
              // exists to show read as nothing moving at all. This is the one
              // value in the file tuned to the surface it sits on rather than
              // taken from the tokens, for the same reason `PILL_W` is.
              backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(26,26,24,0.075)",
            },
            pill,
          ]}
        />

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
              onLayout={(frame) => {
                // Assigning a fresh object rather than mutating: a shared value
                // only notifies the UI thread when it's reassigned.
                slots.value = { ...slots.value, [index]: frame };
                if (Object.keys(slots.value).length >= 2) ready.value = fadeTo(1, timing.quick);
              }}
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
  onLayout,
}: {
  label: string;
  focused: boolean;
  icon?: (props: { focused: boolean; color: string; size: number }) => React.ReactNode;
  testID?: string;
  onPress: () => void;
  onLongPress: () => void;
  onLayout: (frame: LayoutRectangle) => void;
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

  const text = useAnimatedStyle(() => ({
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
      onLayout={(e) => onLayout(e.nativeEvent.layout)}
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
          style={[
            {
              fontSize: LABEL_SIZE,
              // Pinned, so the two font files Android picks for these two
              // weights can't hand back two different line boxes. See the note
              // on LABEL_LINE — this one line is the whole of the icons-jumping
              // fix, and it has to stay whatever else changes here.
              lineHeight: LABEL_LINE,
              // Weight, not just colour. The reference leans on it hard, and it
              // survives where colour doesn't — a green label and a grey one
              // are the same label to anyone who can't separate the two hues.
              // Switched rather than animated: React Native can't interpolate a
              // font weight, and at this size the change reads as the label
              // sharpening rather than as a jump. The item is centred in a
              // flexed cell, so the extra width moves nothing but itself.
              fontWeight: focused ? "700" : "500",
              marginTop: LABEL_GAP,
              // A tab label is a name, not a sentence: on a narrow phone with
              // large text "Customers" would otherwise be squeezed into the
              // neighbouring tabs' space rather than shrinking within its own.
              paddingHorizontal: 2,
              ...Platform.select({ web: { userSelect: "none" as const } }),
            },
            text,
          ]}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}
