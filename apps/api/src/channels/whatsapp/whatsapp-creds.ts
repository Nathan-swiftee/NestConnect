import { env } from "../../config/env";
import type { Store } from "../../data/store";

/** The credentials needed to call the WhatsApp Cloud API for one number. */
export interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
  /** The WhatsApp Business Account id, when the number carries one. */
  wabaId?: string;
}

/**
 * Resolve a WhatsApp number's API credentials: the inbox's own token +
 * phone-number-id (a number connected via Meta) if present, otherwise the global
 * env credentials. Returns null when neither is configured — the caller decides
 * whether that's a mock path (dev) or a hard error (management features).
 */
export async function resolveWhatsAppCreds(
  store: Store,
  inboxId: string,
): Promise<WhatsAppCreds | null> {
  const config = await store.getInboxConfig(inboxId);
  if (config?.phoneNumberId && config?.accessToken) {
    return {
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
      wabaId: config.wabaId,
    };
  }
  if (env.whatsapp.phoneNumberId && env.whatsapp.token) {
    return { phoneNumberId: env.whatsapp.phoneNumberId, accessToken: env.whatsapp.token };
  }
  return null;
}

/** The shape of an error object in a Graph API JSON response. */
interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

/**
 * Turn a Graph API error into a short, human-readable sentence for the agent.
 * Meta's raw messages are wordy and its most common failures (bad/expired token,
 * a token/phone-id mismatch) deserve a plain-English hint about the real fix.
 */
export function metaErrorMessage(error: unknown, httpStatus?: number): string {
  const e = (error ?? {}) as GraphError;
  const code = e.code;
  const sub = e.error_subcode;
  if (code === 190) {
    return "WhatsApp rejected the access token (expired or invalid) — reconnect the number under Channels.";
  }
  if (code === 100 && (sub === 33 || sub === undefined)) {
    return "WhatsApp couldn't find this number — check the Phone number ID matches the access token (a common mix-up is pasting the Business Account ID instead).";
  }
  if (code === 10 || code === 200) {
    return "This access token doesn't have permission for this number — it needs the whatsapp_business_management permission.";
  }
  const base = e.message ? e.message : httpStatus ? `WhatsApp API error (HTTP ${httpStatus})` : "WhatsApp API error";
  return base;
}
