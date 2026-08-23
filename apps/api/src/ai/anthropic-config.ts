import { DEFAULT_POLISH_PROMPT } from "@ding/schemas";
import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import type { Store } from "../data/store";

/* AppSetting keys for the org's Claude (Anthropic) credentials, set in
   Settings › Integrations › AI. `anthropic_api_key` is encrypted at rest. */
export const ANTHROPIC_API_KEY_KEY = "anthropic_api_key";
export const ANTHROPIC_MODEL_KEY = "anthropic_model";
export const ANTHROPIC_POLISH_PROMPT_KEY = "anthropic_polish_prompt";

/** Sonnet is the right default for Polish: it holds a tone brief far better
 *  than a small model, and the task is one short message, so it still returns
 *  in about a second. Workspaces can point this at any model id they have. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** Everything needed to call the Anthropic Messages API for a polish. */
export interface AnthropicConfig {
  apiKey: string;
  model: string;
  polishPrompt: string;
}

/** Read one setting, falling back to its env default; trimmed, "" when unset. */
async function pick(store: Store, orgId: string, key: string, fallback: string): Promise<string> {
  const saved = (await store.getAppSetting(orgId, key))?.trim();
  return saved || fallback;
}

/**
 * Resolve the active Claude configuration. An org's saved settings override the
 * environment defaults per field, so AI assist can be switched on from the UI
 * without a redeploy. Returns null when no API key is available — the caller
 * then reports "not configured" rather than attempting a call.
 */
export async function resolveAnthropicConfig(store: Store, orgId: string = ORG_ID): Promise<AnthropicConfig | null> {
  const [apiKey, model, polishPrompt] = await Promise.all([
    pick(store, orgId, ANTHROPIC_API_KEY_KEY, env.anthropic.apiKey),
    pick(store, orgId, ANTHROPIC_MODEL_KEY, env.anthropic.model),
    pick(store, orgId, ANTHROPIC_POLISH_PROMPT_KEY, DEFAULT_POLISH_PROMPT),
  ]);
  if (!apiKey) return null;
  return { apiKey, model: model || DEFAULT_ANTHROPIC_MODEL, polishPrompt: polishPrompt || DEFAULT_POLISH_PROMPT };
}

/** The non-secret half, for GET /settings/integrations. The key is never echoed. */
export async function anthropicPublicSettings(
  store: Store,
  orgId: string = ORG_ID,
): Promise<{ configured: boolean; model: string; polishPrompt: string }> {
  const [apiKey, model, polishPrompt] = await Promise.all([
    pick(store, orgId, ANTHROPIC_API_KEY_KEY, env.anthropic.apiKey),
    pick(store, orgId, ANTHROPIC_MODEL_KEY, env.anthropic.model),
    pick(store, orgId, ANTHROPIC_POLISH_PROMPT_KEY, DEFAULT_POLISH_PROMPT),
  ]);
  return {
    configured: Boolean(apiKey),
    model: model || DEFAULT_ANTHROPIC_MODEL,
    polishPrompt: polishPrompt || DEFAULT_POLISH_PROMPT,
  };
}
