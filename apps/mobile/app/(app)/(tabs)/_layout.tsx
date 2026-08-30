import { Tabs } from "expo-router";
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

  return (
    <Tabs
      // The bar is ours (`src/components/TabBar.tsx`), for the travelling pill.
      // With one supplied, the `tabBar*` styling options are dead — the stock
      // bar is what reads them — so they're gone from here rather than left
      // behind to look load-bearing. The one thing that still has to be set at
      // this level is `sceneStyle`, which belongs to the screens, not the bar.
      tabBar={(props) => <TabBar {...props} />}
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
  );
}
