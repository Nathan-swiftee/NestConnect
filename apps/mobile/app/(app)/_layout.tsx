import { Stack } from "expo-router";
import { useChatRealtime, useChatStatus, useRealtime } from "@ding/client";
import { useNotificationRouting } from "../../src/notification-routing";
import { useAppBadge } from "../../src/push";
import { useTheme } from "../../src/theme";

/**
 * The signed-in half of the app. The realtime subscription is mounted here
 * rather than per-screen, so the socket stays connected while you move between
 * the list and a thread — reconnecting on every navigation would drop events in
 * the gap.
 *
 * `null` because no conversation is "open" at this level; the thread screen
 * joins its own room.
 */
export default function AppLayout() {
  const { c } = useTheme();
  useRealtime(null);
  // Team Chat's live updates, for as long as the module is on: the list, the
  // badge and an open chat stay current wherever you are in the app.
  useChatRealtime(!!useChatStatus().data?.enabled);
  // Mounted here rather than per-screen so a tap resolves the same way whether
  // the app was cold, backgrounded or already open.
  useNotificationRouting(true);
  // The app icon's number follows what's unread, wherever you are in the app.
  useAppBadge(true);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.bg },
        animation: "slide_from_right",
      }}
    />
  );
}
