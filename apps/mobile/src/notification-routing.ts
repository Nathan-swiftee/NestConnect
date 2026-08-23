import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@ding/client";
import { enqueue } from "./send-queue";
import { loadSession } from "./session";

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
 * Tapping a notification lands in the thread it was about — and the buttons on
 * it do what they say without opening the app at all.
 *
 * Three entry paths reach the same destination, which is the whole point,
 * because they are easy to get subtly different and users notice:
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
 *
 * The three actions are mutually exclusive, which matters more than it looks:
 * only the *default* action (an actual tap on the banner) navigates. Replying
 * from the banner deliberately leaves you where you were — the whole value of a
 * quick reply is not having to go anywhere.
 *
 * Native only. The web build has no notification stack behind these calls, and
 * `getLastNotificationResponseAsync` throws there rather than resolving empty —
 * so the whole hook is a no-op on web instead of a caught error on every mount.
 */
export function useNotificationRouting(enabled: boolean) {
  const handled = useRef(new Set<string>());
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    let cancelled = false;

    /**
     * Send a reply typed into the banner.
     *
     * Through the durable queue rather than straight at the API, for one
     * reason: this runs in a background process that the OS can suspend at any
     * moment, and often on a phone that has just come out of a pocket with no
     * signal. A direct call that fails here fails silently and the reply is
     * gone — the person typed it, saw the banner dismiss, and would never know.
     * Queued, it survives the process dying and goes out on the next flush.
     */
    const reply = async (conversationId: string, text: string) => {
      // The token is read synchronously by the API client from a module cache
      // that the app fills on start. Acting on a notification can beat that:
      // the OS wakes the process for the action, and the first thing it does is
      // this. Loading it here is idempotent and costs one keystore read.
      await loadSession();
      await enqueue({ conversationId, body: text, internal: false });
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    };

    const markRead = async (conversationId: string) => {
      try {
        await loadSession();
        await api.markRead(conversationId);
        qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["views"] });
      } catch {
        // Nothing useful to say from a background process with no UI. The badge
        // corrects itself on the next push, and opening the thread marks it
        // read anyway.
      }
    };

    const handle = (response: Notifications.NotificationResponse) => {
      const key = response.notification.request.identifier + ":" + response.actionIdentifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);

      const id = conversationIdOf(response);
      if (!id) return;

      switch (response.actionIdentifier) {
        case "reply": {
          // `userText` is only present on a text-input action; an empty one is
          // a dismissed keyboard, not a message.
          const text = response.userText?.trim();
          if (text) void reply(id, text);
          return;
        }
        case "read":
          void markRead(id);
          return;
        default:
          // DEFAULT_ACTION_IDENTIFIER — the banner itself was tapped.
          router.push({ pathname: "/(app)/thread/[id]", params: { id } });
      }
    };

    // Cold start: was the app launched by a tap? Failure here is never worth a
    // crash — the worst case is the app opens on the inbox instead of the
    // thread, which is where it would have opened anyway.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!cancelled && response) handle(response);
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [enabled, qc]);
}
