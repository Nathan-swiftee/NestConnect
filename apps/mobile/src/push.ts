import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@ding/client";

/** Set once, before anything can arrive. Foreground behaviour is decided here
 *  rather than per-notification so there's one answer, not several.
 *
 *  A banner still shows in the foreground because the server has already
 *  decided this person isn't looking at that thread — `isViewing` checks the
 *  socket room before it sends. Suppressing again here would silence the
 *  legitimate case: a message in a *different* conversation while the app is
 *  open, which is exactly when a banner is most useful. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Remembers that this person has already been asked, so a decline isn't
 *  re-asked on every launch — iOS only shows the system prompt once anyway, and
 *  nagging is how an app gets its notifications turned off for good. */
const ASKED_KEY = "nest.push.asked.v1";
/** The device row id, kept so sign-out can delete the right one. */
const DEVICE_KEY = "nest.push.deviceId.v1";

/**
 * Android notification channels — one per class, matching the server's map.
 *
 * Mandatory on Android 8+, and the reason someone can silence "every message"
 * while staying reachable for a direct mention. Created before any notification
 * arrives, because a notification naming a channel that doesn't exist is put in
 * a default one and the user's per-class choices stop meaning anything.
 */
async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  const channels: [string, string, Notifications.AndroidImportance][] = [
    ["messages", "Messages", Notifications.AndroidImportance.HIGH],
    ["mentions", "Mentions", Notifications.AndroidImportance.HIGH],
    ["assignments", "Assignments", Notifications.AndroidImportance.DEFAULT],
    ["reminders", "Snooze reminders", Notifications.AndroidImportance.HIGH],
  ];
  await Promise.all(
    channels.map(([id, name, importance]) =>
      Notifications.setNotificationChannelAsync(id, {
        name,
        importance,
        // Group per conversation so the tray shows one entry per chat.
        showBadge: true,
        sound: "default",
      }),
    ),
  );
}

/**
 * iOS notification categories — the quick actions on a pulled-down banner.
 *
 * Registered with the same ids the server sends as `categoryId`. Only messages
 * get one: an assignment or a reminder has nothing to do from the banner except
 * open, and a button that only opens is a button that lies about being a
 * shortcut.
 */
async function ensureCategories(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await Notifications.setNotificationCategoryAsync("message", [
    {
      identifier: "reply",
      buttonTitle: "Reply",
      textInput: { submitButtonTitle: "Send", placeholder: "Message…" },
      options: { opensAppToForeground: false },
    },
    { identifier: "read", buttonTitle: "Mark read", options: { opensAppToForeground: false } },
  ]);
}

/** The Expo push token for this install, or null if push can't work here. */
async function getToken(): Promise<string | null> {
  // A simulator has no APNs/FCM registration to hand out, and asking throws.
  if (!Device.isDevice) return null;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return data;
  } catch {
    return null;
  }
}

/**
 * Push registration, from asking to revoking.
 *
 * The rules this implements, in the order they matter:
 *
 *  - **Never ask on cold start.** The prompt appears once the person is signed
 *    in and has seen the inbox, so "can we notify you" is a question about work
 *    they can already see rather than an interruption before the app has
 *    justified itself. iOS gives exactly one chance at that prompt.
 *  - **Re-register on every start.** Push tokens rotate; the server upsert is
 *    cheap, and sending the new one is the only way we learn the new address.
 *  - **Detect revocation.** Someone can turn notifications off in OS settings
 *    without telling the app. On every foreground the real permission is
 *    re-read, and a revoked one deletes the device row so the server stops
 *    pushing at an address that will never ring.
 *  - **Delete on sign-out.** A signed-out phone that keeps buzzing is a bug
 *    people describe as a security problem, and they're not wrong.
 */
export function usePushRegistration(signedIn: boolean) {
  const [status, setStatus] = useState<Notifications.PermissionStatus | null>(null);
  const registered = useRef(false);

  /** Register (or refresh) this device with the server. */
  const register = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const device = await api.registerDevice({
        pushToken: token,
        platform: Platform.OS === "ios" ? "ios" : "android",
        appVersion: Constants.expoConfig?.version ?? undefined,
        osVersion: Device.osVersion ?? undefined,
        deviceName: Device.deviceName ?? undefined,
      });
      await AsyncStorage.setItem(DEVICE_KEY, device.id);
      registered.current = true;
    } catch {
      // Never fatal: the app works without push, and a failed registration
      // retries on the next foreground.
    }
  }, []);

  /** Stop this device receiving pushes — revocation, or signing out. */
  const unregister = useCallback(async () => {
    registered.current = false;
    const id = await AsyncStorage.getItem(DEVICE_KEY).catch(() => null);
    if (!id) return;
    await api.deleteDevice(id).catch(() => {});
    await AsyncStorage.removeItem(DEVICE_KEY).catch(() => {});
  }, []);

  /**
   * Ask for permission, at the moment the caller decides has earned it.
   *
   * Returns whether it was granted, so the caller can explain what was lost
   * rather than silently doing nothing.
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let next = existing;
    if (existing !== "granted") {
      ({ status: next } = await Notifications.requestPermissionsAsync());
    }
    await AsyncStorage.setItem(ASKED_KEY, "1").catch(() => {});
    setStatus(next);
    if (next === "granted") {
      await ensureAndroidChannels();
      await ensureCategories();
      await register();
    }
    return next === "granted";
  }, [register]);

  /** Whether we've ever put the prompt in front of this person. */
  const hasAsked = useCallback(async () => {
    return (await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) === "1";
  }, []);

  // Re-read the real permission whenever the app comes forward, and reconcile:
  // granted → make sure we're registered (tokens rotate); anything else →
  // make sure we're not, because the OS has stopped delivering.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    const sync = async () => {
      const { status: current } = await Notifications.getPermissionsAsync();
      if (cancelled) return;
      setStatus(current);
      if (current === "granted") {
        await ensureAndroidChannels();
        await ensureCategories();
        await register();
      } else if (registered.current) {
        await unregister();
      }
    };

    void sync();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void sync();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [signedIn, register, unregister]);

  return { status, granted: status === "granted", requestPermission, hasAsked, unregister };
}

/** Clear the app-icon badge — called when the inbox is read. */
export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => {});
}
