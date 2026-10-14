import { env } from "../config/env";
import type { Store } from "../data/store";

/* Platform settings for speech to text (Transcribe on voice notes), set in
   Settings › Integrations › Transcription. `openai_api_key` is encrypted at
   rest. Claude can't listen to audio, so the words come from OpenAI. */
export const OPENAI_API_KEY_KEY = "openai_api_key";
export const OPENAI_TRANSCRIBE_MODEL_KEY = "openai_transcribe_model";

/** Accurate on short, noisy, accented speech — what voice notes are — and
 *  cheap enough to never think about. Overridable per platform. */
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export interface TranscribeConfig {
  apiKey: string;
  model: string;
}

async function pick(store: Store, key: string, fallback: string): Promise<string> {
  const saved = (await store.getPlatformSetting(key))?.trim();
  return saved || fallback;
}

/** The key and model to transcribe with, or null when there's no key. */
export async function resolveTranscribeConfig(store: Store): Promise<TranscribeConfig | null> {
  const [apiKey, model] = await Promise.all([
    pick(store, OPENAI_API_KEY_KEY, env.openai.apiKey),
    pick(store, OPENAI_TRANSCRIBE_MODEL_KEY, env.openai.transcribeModel),
  ]);
  if (!apiKey) return null;
  return { apiKey, model: model || DEFAULT_TRANSCRIBE_MODEL };
}

/** The non-secret half, for GET /settings/integrations. The key is never echoed. */
export async function transcribePublicSettings(store: Store): Promise<{ configured: boolean; model: string }> {
  const [apiKey, model] = await Promise.all([
    pick(store, OPENAI_API_KEY_KEY, env.openai.apiKey),
    pick(store, OPENAI_TRANSCRIBE_MODEL_KEY, env.openai.transcribeModel),
  ]);
  return { configured: Boolean(apiKey), model: model || DEFAULT_TRANSCRIBE_MODEL };
}
