import { useEffect, useRef } from "react";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";

/** What our pushes carry. Anything else is ignored rather than trusted. */
interface PushData {
  kind?: string;
  conversationId?: string;
}

function conversationIdOf(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as PushData | undefined;
  const id = data?.conversationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Tapping a notification lands in the thread it was about.
 *
 * Three entry paths, one destination — which is the whole point, because they
 * are easy to get subtly different and users notice:
 *
 *  - **Cold start.** The app wasn't running. The tap is not an event we can
 *    subscribe to in time, so it's fetched with `getLastNotificationResponseAsync`.
 *  - **Background resume.** The app was alive but backgrounded; the listener
 *    fires.
 *  - **Foreground.** The banner showed while the app was open; the same
 *    listener fires.
 *
 * The cold-start response is also delivered to the listener on some platforms,
 * so responses are de-duplicated by identifier — otherwise a cold start pushes
 * the thread twice and the back button lands on the same screen again.
 */
export function useNotificationRouting(enabled: boolean) {
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const open = (response: Notifications.NotificationResponse) => {
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      const id = conversationIdOf(response);
      if (!id) return;
      router.push({ pathname: "/(app)/thread/[id]", params: { id } });
    };

    // Cold start: was the app launched by a tap?
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!cancelled && response) open(response);
    });

    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [enabled]);
}
