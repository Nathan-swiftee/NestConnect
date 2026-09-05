import type { WhatsAppNumberState, WhatsAppNumberStatus, WhatsAppRegisterResult } from "@ding/schemas";
import { metaErrorMessage } from "../channels/whatsapp/whatsapp-creds";

/**
 * The Cloud API's phone-number registration, as plain functions.
 *
 * Deliberately free of Nest: no decorators, no injection, no Store. The service
 * next door owns credentials, HTTP status codes and logging; everything here is
 * "given these three strings and a fetch, what does Meta say" — which is what
 * makes it exercisable by tools/check-whatsapp-register.ts against a stub
 * instead of against Meta.
 *
 * Why this exists at all: adding a number in WhatsApp Manager is only half of
 * onboarding. Until somebody calls `POST /{phone-number-id}/register`, Meta
 * leaves the number at PENDING and shows "Please register this phone number
 * using the registration API or contact your partner to register the phone
 * number." Nothing in Nest Connect made that call, so a number could look
 * perfectly configured here and be unable to send a single message.
 */

/** Just enough of fetch for these two calls — so a test can pass a stub. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GraphArgs {
  phoneNumberId: string;
  accessToken: string;
  /** The Graph version already configured for this deployment. Never hard-coded
   *  here: a number that sends on v21.0 must register on v21.0. */
  apiVersion: string;
  fetchImpl?: FetchLike;
}

/** The fields of Meta's phone-number node we read. */
interface MetaPhoneNumber {
  id?: string;
  status?: string;
  code_verification_status?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  error?: unknown;
}

/**
 * Meta's phone-number statuses, split by what an admin can do about them.
 *
 * The registerable set is the whole point of this feature: these are the states
 * `POST /register` moves to CONNECTED. Everything outside it either needs no
 * action (CONNECTED) or cannot be fixed by registering — offering a PIN box for
 * a BANNED number would just waste somebody's afternoon.
 */
const REGISTERABLE = new Set(["PENDING", "DISCONNECTED", "MIGRATED", "UNVERIFIED"]);

/** Meta's word for the number's state → ours. */
export function mapMetaStatus(metaStatus: string | undefined): WhatsAppNumberStatus {
  if (!metaStatus) return "meta_error";
  const s = metaStatus.toUpperCase();
  if (s === "CONNECTED") return "connected";
  if (REGISTERABLE.has(s)) return "registration_required";
  return "meta_error";
}

/** The shape of an error object in a Graph API JSON response. */
interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  type?: string;
}

/**
 * Which of our five statuses a Graph failure belongs to.
 *
 * `metaErrorMessage` already writes the sentences for the three failures every
 * Meta integration hits (dead token, wrong id, missing permission); this only
 * decides which bucket they land in, so the two cannot drift apart.
 */
export function classifyGraphError(
  error: unknown,
  httpStatus?: number,
): { status: WhatsAppNumberStatus; detail: string } {
  const e = (error ?? {}) as GraphError;
  const detail = metaErrorMessage(error, httpStatus);
  // 190: the token is expired or invalid. 10 / 200: it is a real token but
  // without whatsapp_business_management, which is the same dead end for the
  // admin — both are fixed by reconnecting with a better token.
  if (e.code === 190 || e.code === 10 || e.code === 200) return { status: "auth_failed", detail };
  // 100 with no subcode is Meta's "unknown path" — nearly always the Business
  // Account ID pasted where the Phone number ID goes.
  if (e.code === 100 || e.code === 803) return { status: "configuration_error", detail };
  return { status: "meta_error", detail };
}

/**
 * Registration failures worth wording ourselves.
 *
 * Only the two an admin will actually meet and can actually act on. Meta's own
 * message is descriptive enough for the rest, and inventing text for codes
 * nobody has seen would be guessing dressed up as help. The PIN codes matter
 * because Meta allows a small number of wrong guesses before locking the number
 * out for a day — telling somebody plainly that the PIN was wrong is what stops
 * them from trying the SMS code next.
 */
const REGISTER_ERRORS: Record<number, string> = {
  133005:
    "That two-step verification PIN doesn't match the one set for this number in Meta. " +
    "It is the 6-digit PIN from WhatsApp Manager › Two-step verification — not the SMS code used to verify the number.",
  133006:
    "Meta needs this number verified again before it can be registered. " +
    "Re-verify it in WhatsApp Manager, then register it here.",
};

/** Read the number's live state from Meta. Never throws: every failure comes
 *  back as a state the UI can render, because "we could not ask" is itself
 *  something the admin needs to see. */
export async function fetchNumberState(args: GraphArgs): Promise<WhatsAppNumberState> {
  const { phoneNumberId, accessToken, apiVersion } = args;
  const doFetch = args.fetchImpl ?? fetch;
  const fields = "id,status,code_verification_status,display_phone_number,verified_name,quality_rating";
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`;

  let res: Response;
  let json: MetaPhoneNumber;
  try {
    // The token goes in the header, never the query string: a URL ends up in
    // proxy logs and error messages, and this one gets logged on failure.
    res = await doFetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    json = (await res.json().catch(() => ({}))) as MetaPhoneNumber;
  } catch (err) {
    return { status: "meta_error", detail: `Couldn't reach WhatsApp: ${String(err)}` };
  }
  if (!res.ok || json.error) {
    const { status, detail } = classifyGraphError(json.error, res.status);
    return { status, detail };
  }

  const status = mapMetaStatus(json.status);
  return {
    status,
    detail: describe(status, json),
    ...(json.status ? { metaStatus: json.status } : {}),
    ...(json.code_verification_status ? { codeVerificationStatus: json.code_verification_status } : {}),
    ...(json.display_phone_number ? { displayNumber: json.display_phone_number } : {}),
    ...(json.verified_name ? { verifiedName: json.verified_name } : {}),
    ...(json.quality_rating ? { qualityRating: json.quality_rating } : {}),
  };
}

/** One sentence for a state Meta actually answered about. */
function describe(status: WhatsAppNumberStatus, json: MetaPhoneNumber): string {
  if (status === "connected") return "This number is registered with Meta and can send and receive.";
  if (status === "registration_required") {
    // NOT_VERIFIED is a different job with a different fix, and sending someone
    // to the PIN box when Meta wants an SMS code is the exact confusion this
    // whole feature exists to end.
    if (json.code_verification_status && json.code_verification_status.toUpperCase() !== "VERIFIED") {
      return (
        `Meta reports this number as ${json.status} and not yet verified. ` +
        "Verify it in WhatsApp Manager first, then register it here with its two-step verification PIN."
      );
    }
    return (
      `Meta reports this number as ${json.status}. ` +
      "Register it with its 6-digit two-step verification PIN to start sending and receiving."
    );
  }
  if (!json.status) {
    return "Meta didn't report a status for this number — check the token has the whatsapp_business_management permission.";
  }
  return `Meta reports this number as ${json.status}, which registering won't change. Check the number in WhatsApp Manager.`;
}

/**
 * Register the number on the Cloud API: `POST /{phone-number-id}/register`.
 *
 * The sequence is state → register → state, and the second read is the one that
 * decides the answer. That matters more than it looks:
 *
 *  - A number that is already registered never gets the call at all, so we do
 *    not spend one of Meta's small number of PIN guesses proving something we
 *    could have read.
 *  - A registration that errors but leaves the number CONNECTED (Meta is not
 *    always consistent about how it reports "already done") is reported as the
 *    success it is, rather than as a failure the admin would retry.
 *  - A registration Meta accepts that leaves the number PENDING is reported as
 *    the failure it is, rather than as the success the 200 implied.
 *
 * In other words the outcome comes from Meta's own state, not from our reading
 * of Meta's response. The `pin` is used here and nowhere else: it is not
 * returned, not stored and not logged.
 */
export async function registerPhoneNumber(args: GraphArgs & { pin: string }): Promise<WhatsAppRegisterResult> {
  const { phoneNumberId, accessToken, apiVersion, pin } = args;
  const doFetch = args.fetchImpl ?? fetch;

  const before = await fetchNumberState(args);
  if (before.status === "connected") {
    return { ok: true, alreadyRegistered: true, state: before };
  }
  // A dead token or a wrong Phone number ID cannot be fixed with a PIN, and
  // sending one anyway would be a guess spent for nothing.
  if (before.status === "auth_failed" || before.status === "configuration_error") {
    return { ok: false, alreadyRegistered: false, state: before };
  }

  let failure: string | undefined;
  try {
    const res = await doFetch(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/register`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: GraphError };
    if (!res.ok || json.error) {
      const code = json.error?.code;
      failure =
        (code !== undefined && REGISTER_ERRORS[code]) ||
        json.error?.error_user_msg ||
        classifyGraphError(json.error, res.status).detail;
    }
  } catch (err) {
    failure = `Couldn't reach WhatsApp: ${String(err)}`;
  }

  // Meta's own state decides, whatever the call said.
  const after = await fetchNumberState(args);
  if (after.status === "connected") {
    return { ok: true, alreadyRegistered: Boolean(failure), state: after };
  }
  if (failure) {
    return { ok: false, alreadyRegistered: false, state: { ...after, detail: failure } };
  }
  return {
    ok: false,
    alreadyRegistered: false,
    state: {
      ...after,
      detail:
        `Meta accepted the registration but still reports this number as ${after.metaStatus ?? "not connected"}. ` +
        "It can take a moment — check again shortly.",
    },
  };
}

/**
 * Remove secrets from anything on its way to a log line.
 *
 * Belt and braces. Nothing here deliberately logs a token or a PIN, but the
 * things we do log — a URL, a Graph error body — are shaped by Meta and by
 * whatever an admin pasted into the form, and one careless template string is
 * all it takes. Cheaper to scrub than to audit every call site forever.
 */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    // Short values are not worth replacing: a 6-digit PIN is also a plausible
    // substring of an id, and blanking every "133005" in an error code would
    // destroy the message we are trying to read.
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  // Whatever else was in there, these two shapes are always a credential.
  out = out.replace(/access_token=[^&\s"']+/gi, "access_token=[redacted]");
  out = out.replace(/(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]");
  return out;
}
