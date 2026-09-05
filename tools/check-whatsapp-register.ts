/**
 * Does registering a WhatsApp number do the right thing?
 *
 * Sibling to `check-routing.ts` and `check-threading.ts`, and here for the same
 * reason: every way of getting this wrong is quiet. A number that reports
 * "Connected" while Meta has it at PENDING looks perfect in the settings screen
 * and cannot send a single message — which is exactly the bug this whole
 * feature exists to fix, so it would be a poor joke to reintroduce it.
 *
 * Two things in particular are worth pinning down, because both are tempting to
 * "simplify" later and both are load-bearing:
 *
 *   - The answer comes from Meta's state, read *after* the call, not from the
 *     call's own response. Meta is not always consistent about how it reports a
 *     number that was already registered, and a 200 does not mean CONNECTED.
 *   - A number that is already registered never gets the call at all. Meta
 *     allows only a handful of wrong PIN guesses before locking the number out
 *     for a day, so spending one to learn something we could have read is a
 *     real cost, not a stylistic one.
 *
 * Runs the real logic against a stubbed fetch, so it is a check of the rules
 * rather than of Meta.
 *
 *     pnpm check:whatsapp-register
 */
import {
  classifyGraphError,
  fetchNumberState,
  mapMetaStatus,
  registerPhoneNumber,
  scrubSecrets,
  type FetchLike,
} from "../apps/api/src/whatsapp-management/whatsapp-registration.logic";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const TOKEN = "EAAGtesttoken0123456789abcdef";
const PHONE_ID = "1029384756";
const API_VERSION = "v21.0";
const PIN = "123456";

/** A Graph response, as `fetch` hands it back. */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/**
 * A stand-in for Meta: answers `GET /{id}` from a script of statuses (one per
 * call, so a number can change between the read before and the read after) and
 * `POST /{id}/register` from a fixed reply. Records every request so the test
 * can assert on what was *not* sent as well as what was.
 */
function stubMeta(opts: {
  statuses: Array<Record<string, unknown> | { httpStatus: number; body: unknown }>;
  register?: { httpStatus: number; body: unknown };
}) {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  let read = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      auth: headers.authorization,
    });
    if (url.endsWith("/register")) {
      const r = opts.register ?? { httpStatus: 200, body: { success: true } };
      return reply(r.httpStatus, r.body);
    }
    const next = opts.statuses[Math.min(read, opts.statuses.length - 1)];
    read += 1;
    if (next && "httpStatus" in next && "body" in next) {
      return reply(next.httpStatus as number, next.body);
    }
    return reply(200, next);
  };
  return { fetchImpl, calls };
}

const args = { phoneNumberId: PHONE_ID, accessToken: TOKEN, apiVersion: API_VERSION };

async function main(): Promise<void> {
  console.log("\nMeta's statuses, mapped\n");
  ok("CONNECTED is connected", mapMetaStatus("CONNECTED") === "connected");
  for (const s of ["PENDING", "DISCONNECTED", "MIGRATED", "UNVERIFIED"]) {
    ok(`${s} can be registered`, mapMetaStatus(s) === "registration_required");
  }
  for (const s of ["BANNED", "RESTRICTED", "FLAGGED", "RATE_LIMITED"]) {
    // Offering a PIN box for these would be a dead end: registering changes
    // nothing about a number Meta has taken action against.
    ok(`${s} is not offered registration`, mapMetaStatus(s) === "meta_error");
  }
  ok("a missing status is not assumed to be fine", mapMetaStatus(undefined) === "meta_error");

  console.log("\nGraph failures, bucketed\n");
  ok("expired token → authentication failed", classifyGraphError({ code: 190 }).status === "auth_failed");
  ok("missing permission → authentication failed", classifyGraphError({ code: 200 }).status === "auth_failed");
  ok("unknown path → configuration error", classifyGraphError({ code: 100 }).status === "configuration_error");
  ok("anything else → Meta API error", classifyGraphError({ code: 4 }).status === "meta_error");
  ok(
    "the bucket carries a sentence, not a code",
    /reconnect the number/i.test(classifyGraphError({ code: 190 }).detail),
  );

  console.log("\nReading a number's state\n");
  {
    const { fetchImpl, calls } = stubMeta({
      statuses: [{ id: PHONE_ID, status: "PENDING", code_verification_status: "VERIFIED", display_phone_number: "+44 20 7946 0100" }],
    });
    const state = await fetchNumberState({ ...args, fetchImpl });
    ok("a PENDING number asks to be registered", state.status === "registration_required", state.detail);
    ok("Meta's own word is kept", state.metaStatus === "PENDING");
    ok("the display number comes back", state.displayNumber === "+44 20 7946 0100");
    ok(
      "the token travels in the header, never the URL",
      calls[0].auth === `Bearer ${TOKEN}` && !calls[0].url.includes(TOKEN),
      calls[0].url,
    );
  }
  {
    const { fetchImpl } = stubMeta({
      statuses: [{ id: PHONE_ID, status: "PENDING", code_verification_status: "NOT_VERIFIED" }],
    });
    const state = await fetchNumberState({ ...args, fetchImpl });
    // The single most confusing dead end in this whole flow: an unverified
    // number wants an SMS code in WhatsApp Manager, not the two-step PIN.
    ok("an unverified number is told to verify first", /verify it in whatsapp manager/i.test(state.detail), state.detail);
  }
  {
    const { fetchImpl } = stubMeta({ statuses: [{ httpStatus: 401, body: { error: { code: 190, message: "expired" } } }] });
    const state = await fetchNumberState({ ...args, fetchImpl });
    ok("a dead token reads as authentication failed", state.status === "auth_failed", state.detail);
  }

  console.log("\nRegistering\n");
  {
    const { fetchImpl, calls } = stubMeta({
      statuses: [{ status: "PENDING", code_verification_status: "VERIFIED" }, { status: "CONNECTED" }],
    });
    const r = await registerPhoneNumber({ ...args, pin: PIN, fetchImpl });
    ok("a pending number registers", r.ok && !r.alreadyRegistered, r.state.detail);
    ok("and ends up connected", r.state.status === "connected");
    const post = calls.find((c) => c.method === "POST");
    ok("the call is the documented one", Boolean(post?.url.endsWith(`/${PHONE_ID}/register`)), post?.url);
    ok(
      "with the documented body",
      post?.body === JSON.stringify({ messaging_product: "whatsapp", pin: PIN }),
      post?.body,
    );
    ok(
      "on the configured Graph version, not a hard-coded one",
      calls.every((c) => c.url.includes(`/${API_VERSION}/`)),
    );
  }
  {
    const { fetchImpl, calls } = stubMeta({ statuses: [{ status: "CONNECTED" }] });
    const r = await registerPhoneNumber({ ...args, pin: PIN, fetchImpl });
    ok("an already-registered number is a success", r.ok && r.alreadyRegistered);
    ok(
      "and does not spend one of Meta's few PIN guesses",
      calls.every((c) => c.method !== "POST"),
      calls.map((c) => c.method).join(","),
    );
  }
  {
    const { fetchImpl } = stubMeta({
      statuses: [{ status: "PENDING", code_verification_status: "VERIFIED" }, { status: "PENDING" }],
      register: { httpStatus: 400, body: { error: { code: 133005, message: "PIN mismatch" } } },
    });
    const r = await registerPhoneNumber({ ...args, pin: "000000", fetchImpl });
    ok("a wrong PIN fails", !r.ok);
    ok(
      "and says it is the PIN, not the SMS code",
      /not the sms code/i.test(r.state.detail),
      r.state.detail,
    );
  }
  {
    // Meta is not always consistent about an already-registered number: the
    // state after the call is the authority, not the call's own response.
    const { fetchImpl } = stubMeta({
      statuses: [{ status: "PENDING", code_verification_status: "VERIFIED" }, { status: "CONNECTED" }],
      register: { httpStatus: 400, body: { error: { code: 100, message: "already registered" } } },
    });
    const r = await registerPhoneNumber({ ...args, pin: PIN, fetchImpl });
    ok("an error over a connected number is not a failure", r.ok && r.alreadyRegistered, r.state.detail);
  }
  {
    const { fetchImpl } = stubMeta({
      statuses: [{ status: "PENDING", code_verification_status: "VERIFIED" }, { status: "PENDING" }],
      register: { httpStatus: 200, body: { success: true } },
    });
    const r = await registerPhoneNumber({ ...args, pin: PIN, fetchImpl });
    ok("a 200 that left the number PENDING is reported as such", !r.ok, r.state.detail);
    ok("and says to check again shortly", /check again shortly/i.test(r.state.detail));
  }
  {
    const { fetchImpl, calls } = stubMeta({ statuses: [{ httpStatus: 401, body: { error: { code: 190 } } }] });
    const r = await registerPhoneNumber({ ...args, pin: PIN, fetchImpl });
    ok("a dead token fails before the PIN is sent", !r.ok && r.state.status === "auth_failed");
    ok(
      "so the PIN never leaves the process",
      calls.every((c) => !(c.body ?? "").includes(PIN)),
    );
  }

  console.log("\nWhat reaches a log line\n");
  ok(
    "a token in a URL is scrubbed",
    !scrubSecrets(`GET /x?access_token=${TOKEN}`, []).includes(TOKEN),
    scrubSecrets(`GET /x?access_token=${TOKEN}`, []),
  );
  ok(
    "a bearer header is scrubbed",
    !scrubSecrets(`authorization: Bearer ${TOKEN}`, []).includes(TOKEN),
  );
  ok("a named secret is scrubbed anywhere", !scrubSecrets(`oops ${TOKEN} oops`, [TOKEN]).includes(TOKEN));
  ok(
    "but an error code is not mistaken for one",
    scrubSecrets("Meta error 133005", [PIN]) === "Meta error 133005",
    scrubSecrets("Meta error 133005", [PIN]),
  );

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
