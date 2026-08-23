import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

/**
 * Crash and error reporting.
 *
 * **Off unless a DSN is configured.** `EXPO_PUBLIC_SENTRY_DSN` is inlined at
 * bundle time, so a build without one never initialises Sentry at all — no
 * network calls, no hooks installed, nothing to explain to a customer running
 * a local build. That also means turning it on is a build-time decision rather
 * than something that can be flipped by accident at runtime.
 *
 * What it does and doesn't send, decided here rather than left to defaults:
 *
 *  - **No message bodies, ever.** This app's whole content is other people's
 *    private conversations. `beforeSend` strips the request body and any
 *    breadcrumb carrying one, so a stack trace can't smuggle a customer's
 *    message into a third party's database. That is a compliance question, not
 *    a preference — see docs/07-infra-security-cost.md.
 *  - **No session replay and no screenshots.** Same reason, more obviously.
 *  - **Traces at 10%.** Enough to see a pattern, not enough to be a second
 *    analytics bill.
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Breadcrumb categories that can carry customer content. */
const NOISY = new Set(["console", "xhr", "fetch"]);

export function initTelemetry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    // The build this crash came from, so a fix can be tied to a release.
    release: Constants.expoConfig?.version ?? undefined,
    dist: String(
      Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? "0",
    ),
    environment: __DEV__ ? "development" : "production",
    tracesSampleRate: 0.1,
    // Defaults that would send content, turned off deliberately.
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb: (crumb) => {
      if (!crumb.category || !NOISY.has(crumb.category)) return crumb;
      // Keep the fact that a request happened and how it went; drop what it
      // carried.
      return { ...crumb, data: { url: crumb.data?.url, status_code: crumb.data?.status_code } };
    },
    beforeSend: (event) => {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      // A breadcrumb that slipped through the filter above still shouldn't
      // carry a body.
      event.breadcrumbs = event.breadcrumbs?.map((b) =>
        b.data && "body" in b.data ? { ...b, data: { ...b.data, body: undefined } } : b,
      );
      return event;
    },
  });
}

/**
 * Report something that went wrong but didn't crash — a failed upload, a
 * rejected send the agent has already been told about.
 *
 * Safe to call whether or not Sentry is configured, so call sites don't have to
 * check.
 */
export function reportError(error: unknown, context?: Record<string, string>): void {
  if (!DSN) return;
  Sentry.captureException(error, context ? { tags: context } : undefined);
}

/** Whether reporting is actually on, for the Settings screen to say so. */
export const telemetryEnabled = Boolean(DSN);
