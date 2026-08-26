import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutRectangle } from "react-native";
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
import { useTheme } from "../theme";

/**
 * The bottom navigation, with a pill that travels.
 *
 * The stock tab bar recolours the selected item and nothing else, so switching
 * tabs is a cut: one icon goes grey, another goes green, and the eye has to
 * find the change. Here a tinted pill slides from the old tab to the new one,
 * which does two things a colour swap can't — it says *where you came from*,
 * and it gives the tap something to land on.
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

/** The pill's box. Wide enough to sit under a 22pt icon with air around it. */
const PILL_W = 62;
const PILL_H = 32;

/** Extra width, as a fraction, at the midpoint of a one-tab hop. */
const STRETCH = 0.24;

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { c } = useTheme();
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
    progress.value = springTo(active, spring.base);
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

    return {
      opacity: ready.value,
      width: PILL_W,
      transform: [{ translateX: cx - PILL_W / 2 }, { scaleX: 1 + away * STRETCH }],
    };
  });

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        backgroundColor: c.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingTop: 8,
        // The bar's height is whatever its contents come to, so Dynamic Type is
        // handled by construction: turn text size up and the labels take the
        // room they need instead of losing their descenders to a fixed height.
        // (React Navigation's own bar pins the label size on iOS to dodge this;
        // we can afford the honest version.) `maxFontSizeMultiplier` on the
        // label caps the growth before the bar starts eating the inbox it
        // exists to navigate.
        //
        // The floor of 10 is for a device with no home indicator, where the
        // inset is 0 and the labels would otherwise sit hard against the glass.
        paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
      }}
      testID="tabbar"
      accessibilityRole="tablist"
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
            top: 8,
            left: 0,
            height: PILL_H,
            borderRadius: PILL_H / 2,
            backgroundColor: c.brandTint,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.glassLine,
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
    on.value = springTo(focused ? 1 : 0, spring.base);
  }, [focused, on]);

  // The whole item shrinks under the thumb — the pill is behind the icon, so
  // dimming the icon alone would look like it had gone unavailable.
  const squeeze = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const active = useAnimatedStyle(() => ({
    opacity: on.value,
    // A hair larger when selected. Not enough to notice as growth — enough that
    // the selected tab has slightly more presence than its neighbours.
    transform: [{ scale: interpolate(on.value, [0, 1], [0.94, 1]) }],
  }));
  const idle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));

  const text = useAnimatedStyle(() => ({
    color: interpolateColor(on.value, [0, 1], [c.textFaint, c.brandStrong]),
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
      <Animated.View style={[{ alignItems: "center" }, squeeze]}>
        <View style={{ height: PILL_H, justifyContent: "center", alignItems: "center" }}>
          <Animated.View style={idle}>{icon?.({ focused: false, color: c.textFaint, size: 22 })}</Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }, active]}>
            {icon?.({ focused: true, color: c.brandStrong, size: 22 })}
          </Animated.View>
        </View>
        <Animated.Text
          numberOfLines={1}
          // Dynamic Type is honoured — the bar's height is computed from the
          // same scale, so the label has room rather than being clipped.
          maxFontSizeMultiplier={1.6}
          style={[
            {
              fontSize: 11,
              fontWeight: "600",
              marginTop: 1,
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
