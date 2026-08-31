import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import type { Store } from "../data/store";

/* AppSetting keys for push delivery, set in Settings › Integrations › Push.
   `expo_access_token` is encrypted at rest; the Firebase values are the
   project's public identifiers and are stored as written. */
export const EXPO_ACCESS_TOKEN_KEY = "expo_access_token";
export const FIREBASE_PROJECT_ID_KEY = "firebase_project_id";
export const FIREBASE_PROJECT_NUMBER_KEY = "firebase_project_number";
export const FIREBASE_APP_ID_KEY = "firebase_app_id";
export const FIREBASE_STORAGE_BUCKET_KEY = "firebase_storage_bucket";

/** Everything needed to send through the Expo push service. */
export interface PushConfig {
  /**
   * Optional. Expo accepts unauthenticated sends, but an access token with
   * "enhanced security" turned on is what stops anyone who learns a device's
   * token from pushing to it in our name. Recommended in production.
   */
  accessToken: string;
}

/**
 * The Firebase project Android notifications travel through.
 *
 * Recorded rather than used. Delivery to an Android phone is
 * app → Expo → FCM → phone: Expo holds the service-account key (uploaded to EAS
 * credentials, never here) and does the FCM call, and the app carries the
 * matching client config in `google-services.json`, compiled in at build time.
 * So the API never talks to Firebase.
 *
 * It is still worth having, for one reason: when pushes stop, the first question
 * is always "which Firebase project is this app actually pointed at?", and the
 * answer used to exist only inside a build artefact and someone's console. These
 * are the public identifiers — a project id and a sender id are printed in every
 * Android app that ships — so recording them costs nothing and turns that
 * question into a screen.
 */
export interface FirebaseProject {
  projectId: string;
  /** The FCM sender id — `project_number` in google-services.json. */
  projectNumber: string;
  /** The Android app's `mobilesdk_app_id`. */
  appId: string;
  storageBucket: string;
}

/**
 * Resolve push credentials. As with the other integrations, an org's saved
 * settings override the environment per field, so push can be configured from
 * the UI without a redeploy.
 *
 * Unlike Claude there's no "not configured" state to guard: Expo sends work
 * without a token, so this always returns a config and the token is simply
 * empty when unset.
 */
export async function resolvePushConfig(store: Store, orgId: string = ORG_ID): Promise<PushConfig> {
  const saved = (await store.getAppSetting(orgId, EXPO_ACCESS_TOKEN_KEY))?.trim();
  return { accessToken: saved || env.push.expoAccessToken };
}

/** Saved settings over environment, per field — same rule as everything else. */
export async function resolveFirebaseProject(
  store: Store,
  orgId: string = ORG_ID,
): Promise<FirebaseProject> {
  const [projectId, projectNumber, appId, storageBucket] = await Promise.all([
    store.getAppSetting(orgId, FIREBASE_PROJECT_ID_KEY),
    store.getAppSetting(orgId, FIREBASE_PROJECT_NUMBER_KEY),
    store.getAppSetting(orgId, FIREBASE_APP_ID_KEY),
    store.getAppSetting(orgId, FIREBASE_STORAGE_BUCKET_KEY),
  ]);
  return {
    projectId: projectId?.trim() || env.firebase.projectId,
    projectNumber: projectNumber?.trim() || env.firebase.projectNumber,
    appId: appId?.trim() || env.firebase.appId,
    storageBucket: storageBucket?.trim() || env.firebase.storageBucket,
  };
}

/** The non-secret half, for GET /settings/integrations. The token is never echoed. */
export async function pushPublicSettings(
  store: Store,
  orgId: string = ORG_ID,
): Promise<{
  configured: boolean;
  projectId: string;
  projectNumber: string;
  appId: string;
  storageBucket: string;
}> {
  const [{ accessToken }, firebase] = await Promise.all([
    resolvePushConfig(store, orgId),
    resolveFirebaseProject(store, orgId),
  ]);
  return { configured: Boolean(accessToken), ...firebase };
}
