import { useRef } from "react";
import { Tabs } from "expo-router";
import { BlurTargetView } from "expo-blur";
import type { View } from "react-native";
import { useMe } from "@ding/client";
import { ContactsIcon, InboxIcon, InsightsIcon, SettingsIcon } from "../../../src/icons";
import { TabBar } from "../../../src/components/TabBar";
import { useTheme } from "../../../src/theme";

/**
 * The app's primary navigation — the web's icon rail, laid along the bottom
 * where a thumb can reach it.
 *
 * The destinations are the rail's, in the rail's order: Inbox, Customers,
 * Insights, Settings. Insights is role-gated the same way, so an agent doesn't
 * see a tab that would only refuse them.
 *
 * A thread is deliberately NOT a tab. It lives on the stack above this layout,
 * so opening a conversation takes the whole screen and the tab bar comes back
 * when you leave it — the same relationship the web has between its list and
 * its thread pane.
 */
export default function TabsLayout() {
  const { c } = useTheme();
  const { data: me } = useMe();

  const elevated = me?.user?.role === "admin" || me?.user?.role === "manager";

  /**
   * What the tab bar's glass is a picture of.
   *
   * On Android, `expo-blur` does not blur "whatever is behind this view" — it
   * blurs a *nominated* subtree, and without one `ExpoBlurView` silently sets
   * its method to `NONE`:
   *
   *     val safeMethod = if (blurTarget != null) method else BlurMethod.NONE
   *
   * No warning, no error: `blurMethod="dimezisBlurView"` simply does nothing and
   * the view renders as a plain semi-transparent panel. That is why the nav bar
   * has been flat white however the intensity and tint were tuned — there was
   * never a blur to tune. The capsule's own opaque backing was all that showed.
   *
   * So the screens get wrapped in the target, and the bar is handed a ref to it.
   * The bar sits inside this subtree, which is the library's intended
   * arrangement — the native view skips its own drawing while it captures, so
   * it cannot photograph itself.
   */
  const blurTarget = useRef<View>(null);

  return (
    <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
    <Tabs
      // The bar is ours (`src/components/TabBar.tsx`), for the travelling pill.
      // With one supplied, the `tabBar*` styling options are dead — the stock
      // bar is what reads them — so they're gone from here rather than left
      // behind to look load-bearing. The one thing that still has to be set at
      // this level is `sceneStyle`, which belongs to the screens, not the bar.
      tabBar={(props) => <TabBar {...props} blurTarget={blurTarget} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color, size }) => <InboxIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: "Customers",
          tabBarIcon: ({ color, size }) => <ContactsIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: "Insights",
          // `href: null` removes the tab entirely rather than hiding a route
          // that could still be reached by URL on the web build.
          href: elevated ? undefined : null,
          tabBarIcon: ({ color, size }) => <InsightsIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <SettingsIcon size={size} color={color} />,
        }}
      />
    </Tabs>
    </BlurTargetView>
  );
}
