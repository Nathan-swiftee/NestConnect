import { Stack } from "expo-router";
import { useRealtime } from "@ding/client";
import { useNotificationRouting } from "../../src/notification-routing";
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
  // Mounted here rather than per-screen so a tap resolves the same way whether
  // the app was cold, backgrounded or already open.
  useNotificationRouting(true);

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
