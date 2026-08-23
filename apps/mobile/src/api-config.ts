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
 * That last part is why this is the Railway service domain and not the product
 * one. `nest.swiftee.co.uk` sat here for a while and never resolved — a build
 * carrying it would have installed, launched, and failed every request, which
 * reads as a broken app rather than a missing DNS record. A URL baked into a
 * shipped binary can't be corrected remotely, so it points at the hostname that
 * is actually serving.
 *
 * **Swap this to the product domain once its DNS is live and Railway has issued
 * the certificate** — verify by loading `/health` over HTTPS on that hostname
 * first, not by assuming propagation.
 *
 * For local development against a laptop, point it at that machine's LAN
 * address — `localhost` on a phone is the phone.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://ding-app-production.up.railway.app";

/**
 * An attachment URL the way React Native needs it: absolute, and carrying the
 * session.
 *
 * The API returns media as a same-origin path (`/api/media/…`), which the web
 * resolves for free. A phone has no origin to resolve against, and
 * `/api/media/:id` sits behind the auth guard — an `<Image>` fetch carries no
 * cookie and no header of its own — so both have to be supplied here.
 */
export function mediaSource(url: string): { uri: string; headers?: Record<string, string> } {
  const uri = /^https?:\/\//.test(url) ? url : `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  const token = sessionToken();
  return token ? { uri, headers: { authorization: `Bearer ${token}` } } : { uri };
}

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
