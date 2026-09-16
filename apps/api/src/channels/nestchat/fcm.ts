import { createSign } from "node:crypto";

/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * Deliberately not an implementation of {@link PushProvider}. That interface
 * serves the agent app: one set of credentials for the whole install, and a
 * receipts endpoint polled minutes later because Expo's accept and its delivery
 * are two separate events.
 *
 * Neither holds here. The credentials belong to *the business's own Firebase
 * project* — Ding's, not ours — so they are per channel rather than per install,
 * and every send has to say which project it is for. And v1 answers
 * synchronously: a token that has been uninstalled comes back as `UNREGISTERED`
 * on the send itself, so there is nothing to poll for and no pending table to
 * keep. Bending one interface over both would mean a credential argument the
 * Expo provider ignores and a `receipts()` that returns an empty array.
 *
 * APNs is reached through the same call. A Flutter app configured with
 * Firebase gets an FCM token on iOS as well, and Google holds the APNs key —
 * which is the reason to use FCM rather than talking to Apple directly for a
 * push we do not own the certificate for.
 */

/** The channelConfig field holding the business's Firebase service account. */
export const FCM_SERVICE_ACCOUNT_FIELD = "fcmServiceAccount";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TIMEOUT_MS = 15_000;
/** Google issues hour-long tokens. Renew early so a send never races expiry. */
const TOKEN_SKEW_MS = 5 * 60_000;

/** The three fields of a service-account JSON that actually matter. */
export interface FcmCredential {
  projectId: string;
  clientEmail: string;
  /** PEM, `\n`-delimited. */
  privateKey: string;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Groups the tray by conversation on both platforms. */
  collapseKey?: string;
  /** Android notification channel id, created by the host app. */
  channelId?: string;
  /** iOS badge. Omitted rather than sent as 0 when we cannot count. */
  badge?: number;
  ttlSeconds?: number;
}

export interface FcmResult {
  token: string;
  ok: boolean;
  /** FCM's error status, e.g. `UNREGISTERED`, `INVALID_ARGUMENT`. */
  error?: string;
  message?: string;
}

/**
 * Read a service-account JSON.
 *
 * Returns null rather than throwing on anything unusable: this parses a blob an
 * admin pasted into a settings box, and the caller's job when it is wrong is to
 * say so, not to fail a message send.
 */
export function parseServiceAccount(raw: string | undefined | null): FcmCredential | null {
  if (!raw?.trim()) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const projectId = typeof json.project_id === "string" ? json.project_id.trim() : "";
  const clientEmail = typeof json.client_email === "string" ? json.client_email.trim() : "";
  const rawKey = typeof json.private_key === "string" ? json.private_key : "";
  // A key pasted through a form, or round-tripped through an env var, arrives
  // with its newlines escaped. Without this the PEM parses as one long line and
  // signing fails with an error that says nothing about why.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  if (!projectId || !clientEmail || !privateKey.includes("BEGIN")) return null;
  return { projectId, clientEmail, privateKey };
}

const b64url = (input: Buffer | string): string =>
  (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");

/**
 * Exchange a service account for an access token, the way Google's own client
 * libraries do: a short self-signed JWT, swapped at the token endpoint.
 *
 * Hand-rolled rather than pulling in `google-auth-library`, which brings a
 * transitive tree considerably larger than the forty lines it would replace,
 * for one grant type we use once an hour.
 */
async function mintAccessToken(cred: FcmCredential): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: cred.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(cred.privateKey))}`;

  const res = await fetchJson<{ access_token?: string; expires_in?: number; error_description?: string }>(
    TOKEN_URL,
    {
      "content-type": "application/x-www-form-urlencoded",
    },
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  );
  if (!res.ok || !res.body?.access_token) {
    throw new Error(res.body?.error_description ?? `token endpoint returned ${res.status}`);
  }
  return {
    token: res.body.access_token,
    expiresAt: Date.now() + (res.body.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS,
  };
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    const parsed = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

interface FcmErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: { "@type"?: string; errorCode?: string }[];
  };
}

/**
 * Sends to FCM, holding one access token per service account.
 *
 * Cached because a token is good for an hour and minting one is a network round
 * trip with an RSA signature in it; keyed by client email so two channels on two
 * Firebase projects never see each other's.
 */
export class FcmSender {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  /** Send one notification. Never throws: a push that cannot be delivered must
   *  not fail the agent's reply, which is already stored and already on screen. */
  async send(cred: FcmCredential, message: FcmMessage): Promise<FcmResult> {
    let access: string;
    try {
      access = await this.accessToken(cred);
    } catch (err) {
      return { token: message.token, ok: false, error: "auth", message: String(err) };
    }

    const ttl = message.ttlSeconds === undefined ? undefined : `${message.ttlSeconds}s`;
    const payload = {
      message: {
        token: message.token,
        notification: { title: message.title, body: message.body },
        // FCM data values must be strings — a number here is rejected outright
        // rather than coerced, which is a 400 for the whole send.
        ...(message.data ? { data: message.data } : {}),
        android: {
          priority: "HIGH" as const,
          ...(ttl ? { ttl } : {}),
          ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}),
          notification: {
            ...(message.channelId ? { channel_id: message.channelId } : {}),
            // One chat is one entry in the tray, not one per message.
            ...(message.collapseKey ? { tag: message.collapseKey } : {}),
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
            ...(message.collapseKey ? { "apns-collapse-id": message.collapseKey } : {}),
            ...(message.ttlSeconds === undefined
              ? {}
              : { "apns-expiration": String(Math.floor(Date.now() / 1000) + message.ttlSeconds) }),
          },
          payload: {
            aps: {
              sound: "default",
              ...(message.badge === undefined ? {} : { badge: message.badge }),
              ...(message.collapseKey ? { "thread-id": message.collapseKey } : {}),
            },
          },
        },
      },
    };

    let res: { ok: boolean; status: number; body: FcmErrorBody | null };
    try {
      res = await fetchJson<FcmErrorBody>(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cred.projectId)}/messages:send`,
        { "content-type": "application/json", authorization: `Bearer ${access}` },
        JSON.stringify(payload),
      );
    } catch (err) {
      return { token: message.token, ok: false, error: "transport", message: String(err) };
    }
    if (res.ok) return { token: message.token, ok: true };

    // A 401 almost always means the cached token went stale early — a clock
    // skew, or a key rotated under us. Drop it so the next send re-mints
    // rather than failing the same way for the rest of the hour.
    if (res.status === 401) this.tokens.delete(cred.clientEmail);
    const detail = res.body?.error?.details?.find((d) => d.errorCode)?.errorCode;
    return {
      token: message.token,
      ok: false,
      error: detail ?? res.body?.error?.status ?? `http_${res.status}`,
      message: res.body?.error?.message,
    };
  }

  private async accessToken(cred: FcmCredential): Promise<string> {
    const cached = this.tokens.get(cred.clientEmail);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const minted = await mintAccessToken(cred);
    this.tokens.set(cred.clientEmail, minted);
    return minted.token;
  }
}

/**
 * Does this error mean the address is gone for good?
 *
 * The distinction that matters: `UNREGISTERED` and `INVALID_ARGUMENT` are the
 * app uninstalled or the token malformed — pushing again will fail forever, so
 * the row is disabled. `UNAVAILABLE` and `INTERNAL` are Google having a
 * moment, and disabling on those would quietly stop notifying a customer
 * because of a blip at the other end.
 */
export function isDeadToken(error: string | undefined): boolean {
  return error === "UNREGISTERED" || error === "INVALID_ARGUMENT" || error === "NOT_FOUND";
}
