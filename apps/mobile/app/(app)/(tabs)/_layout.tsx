import { useWindowDimensions } from "react-native";
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
  const { fontScale } = useWindowDimensions();
  const { data: me } = useMe();

  // Dynamic Type: the bar grows with the label instead of cropping it.
  //
  // A fixed-height bar sized for an 11pt label crops the descenders the moment
  // someone turns text size up — and the people most likely to do that are the
  // least able to guess what the cropped word said. Most apps sidestep this by
  // pinning the label at one size (React Navigation does exactly that on iOS
  // 13+, leaning on the long-press large-content overlay); we can afford to do
  // the honest thing instead and give the text the room it asks for.
  //
  // Capped at 1.6×: past that the bar starts eating the inbox it's meant to
  // navigate, and the large-content viewer — which stays on — is the better
  // answer at accessibility sizes.
  const labelHeight = Math.ceil(11 * Math.min(fontScale, 1.6) * 1.35);
  const elevated = me?.user?.role === "admin" || me?.user?.role === "manager";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brandStrong,
        tabBarInactiveTintColor: c.textFaint,
        // Height and padding are set rather than left to the default: on a
        // device with no home indicator the inset is 0 and the labels sit hard
        // against the screen edge with their descenders clipped. The 43 is the
        // measured chrome — 8 top padding, a 25pt icon box, the 4pt gap, and
        // 6pt of slack — so at the default text size this comes to the same 68
        // it always was, and only grows from there.
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: 43 + labelHeight + (insets.bottom > 0 ? insets.bottom : 10),
          paddingTop: 8,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarAllowFontScaling: true,
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
