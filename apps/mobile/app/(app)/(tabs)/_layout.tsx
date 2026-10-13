import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "expo-router";
import { BlurTargetView } from "expo-blur";
import { Text, View } from "react-native";
import { useChatStatus, useMe, useOpsStatus } from "@ding/client";
import { ContactsIcon, InboxIcon, InsightsIcon, OpsIcon, SettingsIcon, TeamChatIcon } from "../../../src/icons";
import { TabBar, type Tab } from "../../../src/components/TabBar";
import { useTheme } from "../../../src/theme";

/**
 * The app's primary navigation — the web's icon rail, laid along the bottom
 * where a thumb can reach it.
 *
 * The destinations are the rail's, in the rail's order: Inbox, Chat,
 * Customers, Ops, Insights, Settings. Chat only shows while Team Chat is on,
 * with its unread count. Insights is role-gated the same way, so an agent
 * doesn't see a tab that would only refuse them; Ops only shows while the
 * workspace has Business Ops switched on, with a badge for must-reads waiting.
 *
 * A thread is deliberately NOT a tab. It lives on the stack above this layout,
 * so opening a conversation takes the whole screen and the tab bar comes back
 * when you leave it — the same relationship the web has between its list and
 * its thread pane.
 *
 * ## Why the bar is a sibling of the navigator rather than its `tabBar`
 *
 * The bar's glass is a picture of a nominated subtree — Android's blur is not
 * ambient, and `ExpoBlurView` silently falls back to no blur without a
 * `blurTarget`:
 *
 *     val safeMethod = if (blurTarget != null) method else BlurMethod.NONE
 *
 * The obvious place to nominate is everything the bar floats over, which is the
 * navigator. But the navigator's `tabBar` prop renders the bar *inside* it — so
 * the blur view ended up a descendant of the subtree it photographs, asking that
 * subtree to draw itself while being part of it.
 *
 * That is a loop, and it is the one structural mistake that survived every other
 * change while the app crashed on launch: the radius, the blur method, the
 * target registration and the pill's animated style were each fixed in turn and
 * each build still died before first paint. `expo-blur`'s own changelog puts
 * this exact area under suspicion — 55.0.9 fixed a "Fabric mount/detach mismatch
 * in `BlurTargetView` that could trigger 'view already removed from parent'
 * errors during root tree transitions", and this app is on Fabric, on the newest
 * release, wrapping an entire navigator.
 *
 * So the target holds the screens and *only* the screens. The bar renders after
 * it, as a sibling, over the top. What that costs is the navigator's own
 * `tabBar` plumbing — `state`, `descriptors`, `navigation` — so the bar works
 * out where it is from the URL instead; see `TabBar`.
 */
export default function TabsLayout() {
  const { c } = useTheme();
  const { data: me } = useMe();

  const elevated = me?.user?.role === "admin" || me?.user?.role === "manager";
  const ops = useOpsStatus();
  const opsOn = !!ops.data?.enabled;
  const opsWaiting = ops.data?.pendingAcks ?? 0;
  const chat = useChatStatus();
  const chatOn = !!chat.data?.enabled;
  const chatUnread = chat.data?.unread ?? 0;

  /**
   * The destinations, declared once.
   *
   * They have to agree with the `<Tabs.Screen>`s below — the screens are what
   * the router mounts, this is what the bar draws — so they live next to each
   * other rather than in two files that can drift apart.
   */
  const tabs = useMemo<Tab[]>(
    () =>
      [
        { name: "index", label: "Inbox", href: "/", icon: InboxIcon },
        ...(chatOn ? [{ name: "chat", label: "Chat", href: "/chat", icon: TeamChatIcon, badge: chatUnread, badgeColor: "wa" as const }] : []),
        { name: "customers", label: "Customers", href: "/customers", icon: ContactsIcon },
        ...(opsOn ? [{ name: "ops", label: "Ops", href: "/ops", icon: OpsIcon, badge: opsWaiting }] : []),
        ...(elevated
          ? [{ name: "insights", label: "Insights", href: "/insights", icon: InsightsIcon }]
          : []),
        { name: "settings", label: "Settings", href: "/settings", icon: SettingsIcon },
      ].map((t) => ({
        ...t,
        // The bar asks for a focused flag and a colour; the icons take both.
        icon: ({ color, size }: { color: string; size: number }) => (
          <View>
            <t.icon size={size} color={color} />
            {"badge" in t && t.badge ? <Badge n={t.badge} chat={"badgeColor" in t} /> : null}
          </View>
        ),
      })),
    [elevated, opsOn, opsWaiting, chatOn, chatUnread],
  );

  /**
   * What the glass is a picture of, and why the ref is gated on `attached`.
   *
   * From `BlurView.js`:
   *
   *     componentDidMount() { this._updateBlurTargetId(); }
   *     componentDidUpdate(prev) {
   *       if (prev.blurTarget?.current !== this.props.blurTarget?.current) …
   *     }
   *
   * Two things defeat a plain ref together. React attaches refs bottom-up, so
   * the BlurView can mount and read `.current` before this one is filled in. And
   * the update guard compares `.current` on `prevProps.blurTarget` against
   * `.current` on `props.blurTarget`, which for a `useRef` is the *same object*:
   * the readings are always identical, so the guard can never fire and the id is
   * never filled in afterwards.
   *
   * Gating on state changes the prop's identity once — `undefined` to the ref —
   * which is a difference the guard can see. The effect runs after commit, by
   * which point the ref is attached.
   */
  const blurTarget = useRef<View>(null);
  const [attached, setAttached] = useState(false);
  useEffect(() => setAttached(true), []);

  return (
    <View style={{ flex: 1 }}>
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
        <Tabs
          // No bar from the navigator. Ours is rendered below, outside the blur
          // target — see the note at the top of this file. `sceneStyle` is the
          // one thing that still belongs here, because it belongs to the
          // screens rather than to the bar.
          tabBar={() => null}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: c.bg },
          }}
        >
          <Tabs.Screen name="index" options={{ title: "Inbox" }} />
          <Tabs.Screen name="chat" options={{ title: "Chat", href: chatOn ? undefined : null }} />
          <Tabs.Screen name="customers" options={{ title: "Customers" }} />
          <Tabs.Screen name="ops" options={{ title: "Ops", href: opsOn ? undefined : null }} />
          <Tabs.Screen
            name="insights"
            options={{
              title: "Insights",
              // `href: null` removes the route entirely rather than hiding one
              // that could still be reached by URL on the web build.
              href: elevated ? undefined : null,
            }}
          />
          <Tabs.Screen name="settings" options={{ title: "Settings" }} />
        </Tabs>
      </BlurTargetView>

      <TabBar tabs={tabs} blurTarget={attached ? blurTarget : undefined} />
    </View>
  );
}

/** Must-reads waiting on the Ops icon (amber); unread messages on Chat (green, like WhatsApp's). */
function Badge({ n, chat = false }: { n: number; chat?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityLabel={chat ? `${n} unread` : `${n} to confirm`}
      style={{ position: "absolute", top: -4, right: -8, backgroundColor: chat ? c.wa : c.amber, borderColor: c.bg, borderWidth: 2 }}
      className="h-[18px] min-w-[18px] items-center justify-center rounded-full px-1"
    >
      <Text className="text-[10px] font-bold text-white">{n > (chat ? 99 : 9) ? (chat ? "99+" : "9+") : n}</Text>
    </View>
  );
}
