import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import type { Store } from "../data/store";

/* AppSetting keys for the org's SMTP (transactional email) credentials,
   set in Settings › Setup. `smtp_password` is encrypted at rest. */
export const SMTP_HOST_KEY = "smtp_host";
export const SMTP_PORT_KEY = "smtp_port";
export const SMTP_USERNAME_KEY = "smtp_username";
export const SMTP_PASSWORD_KEY = "smtp_password";
export const SMTP_FROM_KEY = "smtp_from";
export const SMTP_SECURE_KEY = "smtp_secure";

/** Everything the mailer needs to open an authenticated SMTP session. */
export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  secure: boolean;
}

/** Read one setting, falling back to its env default; trimmed, "" when unset. */
async function pick(store: Store, orgId: string, key: string, fallback: string): Promise<string> {
  const saved = (await store.getAppSetting(orgId, key))?.trim();
  return saved || fallback;
}

/**
 * Resolve the active SMTP configuration. An org's saved Setup credentials
 * override the environment defaults, per field, so email can be enabled from the
 * UI without a redeploy. Returns null unless host + username + password + from
 * are all present — the caller then falls back to Postmark (or no send at all).
 */
export async function resolveSmtpConfig(store: Store, orgId: string = ORG_ID): Promise<SmtpConfig | null> {
  const [host, portStr, username, password, fromRaw, secureStr] = await Promise.all([
    pick(store, orgId, SMTP_HOST_KEY, env.smtp.host),
    pick(store, orgId, SMTP_PORT_KEY, String(env.smtp.port)),
    pick(store, orgId, SMTP_USERNAME_KEY, env.smtp.username),
    pick(store, orgId, SMTP_PASSWORD_KEY, env.smtp.password),
    pick(store, orgId, SMTP_FROM_KEY, env.smtp.from),
    pick(store, orgId, SMTP_SECURE_KEY, env.smtp.secure ? "true" : "false"),
  ]);
  const from = fromRaw || username; // From defaults to the login (Gmail) address.
  const port = Number(portStr) || 587;
  if (host && username && password && from) {
    return { host, port, username, password, from, secure: secureStr === "true" };
  }
  return null;
}

/* AppSetting keys for the org's Resend (transactional email) credentials, set in
   Settings › Setup. `resend_api_key` is encrypted at rest. */
export const RESEND_API_KEY_KEY = "resend_api_key";
export const RESEND_FROM_KEY = "resend_from";

/** Everything the mailer needs to send via Resend's HTTPS API. */
export interface ResendConfig {
  apiKey: string;
  from: string;
}

/**
 * Resolve the active Resend configuration. An org's saved Setup values override
 * the environment defaults (RESEND_API_KEY / RESEND_FROM), so Resend can be
 * enabled from the UI without a redeploy. Returns null unless an API key is
 * present — the caller then falls back to Gmail/SMTP/Postmark.
 */
export async function resolveResendConfig(store: Store, orgId: string = ORG_ID): Promise<ResendConfig | null> {
  const [apiKey, fromRaw] = await Promise.all([
    pick(store, orgId, RESEND_API_KEY_KEY, env.resend.apiKey),
    pick(store, orgId, RESEND_FROM_KEY, env.resend.from),
  ]);
  const from = fromRaw || env.email.from; // From defaults to the customer-email from-address.
  if (apiKey && from) return { apiKey, from };
  return null;
}

/** The non-secret Resend settings for echoing back to the UI (key never returned). */
export async function resendPublicSettings(
  store: Store,
  orgId: string = ORG_ID,
): Promise<{ configured: boolean; from: string }> {
  const [config, from] = await Promise.all([
    resolveResendConfig(store, orgId),
    pick(store, orgId, RESEND_FROM_KEY, env.resend.from),
  ]);
  return { configured: config !== null, from: from || env.email.from };
}

/** The non-secret parts of the current config, for echoing back to the UI. */
export async function smtpPublicSettings(
  store: Store,
  orgId: string = ORG_ID,
): Promise<{ configured: boolean; host: string; port: number; username: string; from: string; secure: boolean }> {
  const [config, host, portStr, username, from, secureStr] = await Promise.all([
    resolveSmtpConfig(store, orgId),
    pick(store, orgId, SMTP_HOST_KEY, env.smtp.host),
    pick(store, orgId, SMTP_PORT_KEY, String(env.smtp.port)),
    pick(store, orgId, SMTP_USERNAME_KEY, env.smtp.username),
    pick(store, orgId, SMTP_FROM_KEY, env.smtp.from),
    pick(store, orgId, SMTP_SECURE_KEY, env.smtp.secure ? "true" : "false"),
  ]);
  return {
    configured: config !== null,
    host,
    port: Number(portStr) || 587,
    username,
    from: from || username,
    secure: secureStr === "true",
  };
}
