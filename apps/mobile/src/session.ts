import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Where the session token lives on a phone.
 *
 * `expo-secure-store` is the Keychain on iOS and EncryptedSharedPreferences on
 * Android — not AsyncStorage, which is a plain file any process with the app's
 * sandbox can read, and which survives in device backups. The token is a
 * 60-day credential for a live inbox, so it belongs in the OS keystore.
 *
 * The value is also mirrored in a module variable, because it is read on every
 * request and every socket (re)connect and SecureStore is asynchronous — a
 * promise there would mean an async hop per call, or a token that isn't ready
 * when the first request fires.
 */
const KEY = "nest.session.token";

let cached: string | null = null;
let loaded = false;

/**
 * SecureStore has no web implementation — it throws rather than degrading. The
 * web target exists so the app can be driven in a browser during development
 * and verification; it is not a surface we ship, and `localStorage` is the
 * honest equivalent there. Everything below routes through this so the two
 * platforms can't diverge in behaviour, only in where the bytes land.
 */
const store = {
  get: async (): Promise<string | null> =>
    Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY),
  set: async (value: string): Promise<void> => {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(KEY, value);
    await SecureStore.setItemAsync(KEY, value, {
      // Available after the first unlock so a background push registration can
      // still authenticate, but never restored onto a different device.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  remove: async (): Promise<void> => {
    if (Platform.OS === "web") return void globalThis.localStorage?.removeItem(KEY);
    await SecureStore.deleteItemAsync(KEY);
  },
};

/** Read the stored token into memory. Call once, before the app renders. */
export async function loadSession(): Promise<string | null> {
  if (loaded) return cached;
  try {
    cached = await store.get();
  } catch {
    // A keystore that won't open (a device in an odd state) is a signed-out
    // app, not a crashed one.
    cached = null;
  }
  loaded = true;
  return cached;
}

/** The token, synchronously — this is what the API client and socket call. */
export function sessionToken(): string | null {
  return cached;
}

export async function saveSession(token: string): Promise<void> {
  cached = token;
  loaded = true;
  await store.set(token);
}

export async function clearSession(): Promise<void> {
  cached = null;
  loaded = true;
  await store.remove().catch(() => {});
}

/**
 * This phone's remembered-device pass: proof it passed the second factor, so
 * the next sign-in within 30 days asks for the password and not a code.
 *
 * Its own key, and kept through sign-out — forgetting it there would bring the
 * code straight back, which is the thing it exists to stop. It opens nothing on
 * its own: the server still wants the password, refuses it as a session, and
 * forgets it when the password or the second factor changes.
 */
const TRUST_KEY = "nest.trusted.device";

export async function loadTrustedDevice(): Promise<string | undefined> {
  try {
    const value =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(TRUST_KEY)
        : await SecureStore.getItemAsync(TRUST_KEY);
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

export async function saveTrustedDevice(token: string): Promise<void> {
  try {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(TRUST_KEY, token);
    await SecureStore.setItemAsync(TRUST_KEY, token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch {
    // Not remembered is a code next time, not a failed sign-in.
  }
}
