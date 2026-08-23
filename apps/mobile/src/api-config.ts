import Constants from "expo-constants";
import { configureClient } from "@ding/client";
import { clearSession, sessionToken } from "./session";

/**
 * Where this build talks to.
 *
 * A phone has no "same origin" to fall back on, so the API URL is baked into
 * the build through `EXPO_PUBLIC_API_URL` (Expo inlines any `EXPO_PUBLIC_*` at
 * bundle time). The fallback is the production deployment, so a device build
 * with nothing configured still reaches a real API rather than failing in a way
 * that looks like a bug in the app.
 *
 * For local development against a laptop, point it at that machine's LAN
 * address — `localhost` on a phone is the phone.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://nest.swiftee.co.uk";

let onSignedOut: () => void = () => {};

/** Let the root layout say what "back to sign-in" means, once the router exists. */
export function setSignOutHandler(fn: () => void): void {
  onSignedOut = fn;
}

/**
 * Point the shared client at this app. Called once, before anything renders.
 *
 * `getToken` is a function rather than a value because the token changes —
 * signing in, refreshing, signing out — and both the fetch layer and every
 * socket reconnect read it fresh.
 */
export function configureMobileClient(): void {
  configureClient({
    baseUrl: API_URL,
    auth: { kind: "bearer", getToken: sessionToken },
    // No sound cues: a phone already has the OS notification sound, and a
    // second one from inside the app is just noise.
    cues: {},
    onSignedOut: () => {
      void clearSession();
      onSignedOut();
    },
  });
}
