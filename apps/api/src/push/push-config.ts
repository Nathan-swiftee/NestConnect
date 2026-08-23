import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import type { Store } from "../data/store";

/* AppSetting keys for push delivery, set in Settings › Integrations › Push.
   `expo_access_token` is encrypted at rest. */
export const EXPO_ACCESS_TOKEN_KEY = "expo_access_token";

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

/** The non-secret half, for GET /settings/integrations. The token is never echoed. */
export async function pushPublicSettings(
  store: Store,
  orgId: string = ORG_ID,
): Promise<{ configured: boolean }> {
  const { accessToken } = await resolvePushConfig(store, orgId);
  return { configured: Boolean(accessToken) };
}
