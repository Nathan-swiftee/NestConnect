import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@ding/client";
import { ContactsIcon, InboxIcon, InsightsIcon, SettingsIcon } from "../../../src/icons";
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
  const insets = useSafeAreaInsets();
  const { data: me } = useMe();
  const elevated = me?.user?.role === "admin" || me?.user?.role === "manager";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brandStrong,
        tabBarInactiveTintColor: c.textFaint,
        // Height and padding are set rather than left to the default: on a
        // device with no home indicator the inset is 0 and the labels sit hard
        // against the screen edge with their descenders clipped. 68 leaves ~50
        // of content for a 24px icon plus an 11px label and the gap between —
        // measured, because a tighter box silently crops the labels instead of
        // overflowing visibly.
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: 68 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
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
