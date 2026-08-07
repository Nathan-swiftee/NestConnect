import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import type { Store } from "../data/store";

/* AppSetting keys for the org's Cloudflare R2 credentials (set in Settings › Setup). */
export const R2_ACCOUNT_ID_KEY = "r2_account_id";
export const R2_ACCESS_KEY_ID_KEY = "r2_access_key_id";
export const R2_SECRET_ACCESS_KEY_KEY = "r2_secret_access_key";
export const R2_BUCKET_KEY = "r2_bucket";

/** Everything the R2 driver needs to sign S3-compatible requests. */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Read one setting, falling back to its env default; trimmed, "" when unset. */
async function pick(store: Store, orgId: string, key: string, fallback: string): Promise<string> {
  const saved = (await store.getAppSetting(orgId, key))?.trim();
  return saved || fallback;
}

/**
 * Resolve the active R2 configuration. An org's saved Setup credentials override
 * the environment defaults, per field, so R2 can be enabled from the UI without a
 * redeploy. Returns null unless all four values are present — the caller then
 * falls back to local-disk storage.
 */
export async function resolveR2Config(store: Store, orgId: string = ORG_ID): Promise<R2Config | null> {
  const [accountId, accessKeyId, secretAccessKey, bucket] = await Promise.all([
    pick(store, orgId, R2_ACCOUNT_ID_KEY, env.r2.accountId),
    pick(store, orgId, R2_ACCESS_KEY_ID_KEY, env.r2.accessKeyId),
    pick(store, orgId, R2_SECRET_ACCESS_KEY_KEY, env.r2.secretAccessKey),
    pick(store, orgId, R2_BUCKET_KEY, env.r2.bucket),
  ]);
  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return { accountId, accessKeyId, secretAccessKey, bucket };
  }
  return null;
}

/** The non-secret parts of the current config, for echoing back to the UI. */
export async function r2PublicSettings(
  store: Store,
  orgId: string = ORG_ID,
): Promise<{ configured: boolean; accountId: string; bucket: string }> {
  const [config, accountId, bucket] = await Promise.all([
    resolveR2Config(store, orgId),
    pick(store, orgId, R2_ACCOUNT_ID_KEY, env.r2.accountId),
    pick(store, orgId, R2_BUCKET_KEY, env.r2.bucket),
  ]);
  return { configured: config !== null, accountId, bucket };
}
