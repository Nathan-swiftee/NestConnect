/**
 * The gate a signed-in session sits behind until the account has a second factor.
 *
 * Sibling to check-routing.ts and check-threading.ts. Mandatory two-factor was
 * enforced by the web app and nowhere else: `App.tsx` drew an enrolment screen
 * for anyone who hadn't set one up, and that was the whole of it. A caller that
 * never met that screen — curl, the mobile app, anything holding a bearer token
 * — was never asked, so on a deployment where 2FA is mandatory (which is every
 * production one) a password alone was the entire credential for the workspace.
 *
 * The rule is enforced in the guard now, and this pins down the ways that goes
 * wrong. All of them are silent:
 *
 *   - Too few routes on the allowlist and the gate is a locked room: the one
 *     person who most needs to enrol is refused the endpoint that would let
 *     them, and their only remaining move is to sign out.
 *   - Too many and the hole is back, quietly, for whichever route was added.
 *   - Refusing with the wrong status turns it into a sign-in loop.
 *   - Asking the token instead of the account would exempt every session handed
 *     out before the rule existed, which on a phone is a 60-day token.
 *
 * The allowlist is asserted as a *set*, not just checked for the entries it
 * ought to contain. A route that gains the decorator without a line here fails.
 *
 *     pnpm check:2fa-gate
 */
import { Reflector } from "@nestjs/core";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../apps/api/src/config/env";
import { AuthService } from "../apps/api/src/auth/auth.service";
import { TwoFactorService as RealTwoFactorService } from "../apps/api/src/auth/two-factor.service";
import type { SessionService } from "../apps/api/src/auth/session.service";
import type { TwoFactorService } from "../apps/api/src/auth/two-factor.service";
import { AuthGuard } from "../apps/api/src/auth/auth.guard";
import { AuthController } from "../apps/api/src/auth/auth.controller";
import { IS_ENROLMENT_ALLOWED_KEY } from "../apps/api/src/auth/enrolment-allowed.decorator";
import { IS_PUBLIC_KEY } from "../apps/api/src/auth/public.decorator";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/**
 * Everything an un-enrolled session is allowed to reach, and nothing else.
 *
 * Each is here because without it somebody is stuck: read who you are and
 * whether the rule applies; see what you've already got; start and finish
 * either method; or give up and sign out. Adding to this list is adding to what
 * a password alone can do — which is the thing the gate exists to stop.
 */
const ALLOWED = [
  "logout",
  "session",
  "twoFactorStatus",
  "startTotp",
  "enableTotp",
  "startEmail",
  "enableEmail",
] as const;

const auth = new AuthService(null as never);
// The guard only ever asks these two things of a session, and a check of the
// gate is not a check of revocation — that has its own path above this one.
const sessions = { isValid: async () => true, touch: () => {} } as unknown as SessionService;

/** Counted, so the check can show the allowlist is settled without a lookup. */
let asked = 0;
let enrolledAnswer = false;
const twoFactor = {
  isEnrolled: async () => {
    asked++;
    return enrolledAnswer;
  },
} as unknown as TwoFactorService;

const reflector = new Reflector();
const guard = new AuthGuard(reflector, auth, sessions, twoFactor);

type Handler = (...args: unknown[]) => unknown;
const handler = (name: string): Handler =>
  (AuthController.prototype as unknown as Record<string, Handler>)[name];

/** A request carrying `token` in the cookie a browser would use. */
function ctxFor(name: string, token?: string): ExecutionContext {
  const req = { headers: {}, cookies: token ? { [env.auth.cookieName]: token } : {} } as unknown as Request;
  return {
    getType: () => "http",
    getHandler: () => handler(name),
    getClass: () => AuthController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** Run the guard and report what happened, rather than which exception class. */
async function attempt(name: string, token?: string): Promise<"allowed" | "401" | "403" | "other"> {
  try {
    await guard.canActivate(ctxFor(name, token));
    return "allowed";
  } catch (err) {
    if (err instanceof ForbiddenException) return "403";
    if (err instanceof UnauthorizedException) return "401";
    return "other";
  }
}

async function main(): Promise<void> {
  const token = auth.sign("user_1", "sess_1", 600);

  console.log("\nAn account with no second factor\n");
  enrolledAnswer = false;
  // "sessions" (the devices list) stands in for the rest of the app: it needs a
  // session, it is not enrolment, and it is not special in any way.
  ok("an ordinary route is refused", (await attempt("listSessions", token)) === "403");
  ok(
    "with a 403, not a 401",
    (await attempt("listSessions", token)) !== "401",
    // A 401 would read as "signed out" to every client we have, and the fix for
    // signed out is to sign in — which lands them right back here. The loop is
    // the bug, not the status code.
    "a 401 sends the client to sign-in, which returns the same un-enrolled account",
  );
  ok("and still 401s with no token at all", (await attempt("listSessions")) === "401");
  for (const name of ALLOWED) {
    ok(`it still reaches ${name}`, (await attempt(name, token)) === "allowed");
  }

  console.log("\nOnce there is one\n");
  enrolledAnswer = true;
  ok("the app opens up", (await attempt("listSessions", token)) === "allowed");
  // No token is re-minted anywhere, so this has to be true on the very next
  // request or enrolling wouldn't appear to have worked.
  ok("on the same token that was just being refused", (await attempt("refresh", token)) === "allowed");

  console.log("\nWhat the gate costs\n");
  enrolledAnswer = false;
  asked = 0;
  for (const name of ALLOWED) await attempt(name, token);
  ok("the allowlist is settled without asking the store", asked === 0, `${asked} lookup(s)`);
  asked = 0;
  await attempt("listSessions", token);
  ok("and an ordinary route asks exactly once", asked === 1, `${asked} lookup(s)`);

  console.log("\nWhere two-factor isn't required\n");
  // Dev and local runs. The rule is the deployment's, not the guard's.
  process.env.AUTH_REQUIRE_2FA = "false";
  enrolledAnswer = false;
  asked = 0;
  ok("an un-enrolled account is left alone", (await attempt("listSessions", token)) === "allowed");
  ok("and nothing is looked up at all", asked === 0, `${asked} lookup(s)`);
  delete process.env.AUTH_REQUIRE_2FA;
  ok("…and the rule comes straight back", (await attempt("listSessions", token)) === "403");

  console.log("\nThe lookup the guard leans on\n");
  // The cache is asymmetric on purpose, and both halves matter. A cached "not
  // enrolled" would leave somebody staring at the gate for a minute after they
  // had finished setting it up — which nobody reads as a cache; they read it as
  // the setup not having worked, and try again.
  let reads = 0;
  let enabled = false;
  const store = {
    getUser: async () => {
      reads++;
      return { id: "user_1", twoFactorEnabled: enabled };
    },
    updateTwoFactor: async () => {},
    replaceRecoveryCodes: async () => {},
  };
  const svc = new RealTwoFactorService(store as never, null as never, null as never);

  ok("nothing set up → not enrolled", (await svc.isEnrolled("user_1")) === false);
  reads = 0;
  await svc.isEnrolled("user_1");
  await svc.isEnrolled("user_1");
  ok("and that answer is never cached", reads === 2, `${reads} read(s) for 2 calls`);

  enabled = true;
  ok("enrolling is seen on the very next request", (await svc.isEnrolled("user_1")) === true);
  reads = 0;
  await svc.isEnrolled("user_1");
  await svc.isEnrolled("user_1");
  ok("and then stays off the hot path", reads === 0, `${reads} read(s) for 2 calls`);

  enabled = false;
  await svc.disable("user_1");
  ok("turning it off takes hold at once, not when the cache lapses", (await svc.isEnrolled("user_1")) === false);

  console.log("\nThe allowlist is exactly that list\n");
  const decorated = Object.getOwnPropertyNames(AuthController.prototype)
    .filter((n) => n !== "constructor" && typeof handler(n) === "function")
    .filter((n) => reflector.get<boolean>(IS_ENROLMENT_ALLOWED_KEY, handler(n)) === true)
    .sort();
  const expected = [...ALLOWED].sort();
  ok(
    "no route has quietly joined it",
    decorated.every((n) => expected.includes(n)),
    decorated.filter((n) => !expected.includes(n)).join(", ") || "none extra",
  );
  ok(
    "and none has quietly left",
    expected.every((n) => decorated.includes(n)),
    expected.filter((n) => !decorated.includes(n)).join(", ") || "none missing",
  );
  ok(
    "every name on it is a real handler",
    ALLOWED.every((n) => typeof handler(n) === "function"),
    ALLOWED.filter((n) => typeof handler(n) !== "function").join(", ") || "all present",
  );

  console.log("\nEnrolment still needs a session\n");
  // Every enrolment route acts on "whoever is calling". A public one would let
  // an unauthenticated caller set up a second factor on somebody else's
  // account — an account takeover dressed as a security feature.
  const publicOnes = ALLOWED.filter((n) => reflector.get<boolean>(IS_PUBLIC_KEY, handler(n)) === true);
  ok(
    "only logout is public",
    publicOnes.length === 1 && publicOnes[0] === "logout",
    publicOnes.join(", ") || "none",
  );

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
