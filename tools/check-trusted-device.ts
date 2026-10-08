/**
 * "Remember this device for 30 days" at the two-step sign-in.
 *
 * Asked for because the code was demanded at every single sign-in, on the same
 * laptop, every day. The convenience is the easy half. What this pins down is
 * the other half: everything a remembered device must still NOT be able to do.
 *
 *   - It skips the code, never the password.
 *   - It is never a session in itself, nor a pending 2FA token.
 *   - It belongs to one account; somebody else's does nothing for yours.
 *   - Changing the password, or the second factor, forgets every device.
 *   - It runs out after 30 days.
 *
 * Driven through the real AuthController and AuthService, with a store that
 * holds one account.
 *
 *     pnpm check:trusted-device
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { env } from "../apps/api/src/config/env";
import { AuthService, TRUSTED_DEVICE_TTL_S } from "../apps/api/src/auth/auth.service";
import { AuthController } from "../apps/api/src/auth/auth.controller";
import type { SessionService } from "../apps/api/src/auth/session.service";
import type { TwoFactorService } from "../apps/api/src/auth/two-factor.service";
import type { Store } from "../apps/api/src/data/store";
import type { Mailer } from "../apps/api/src/mail/mailer.service";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const TRUSTED_COOKIE = `${env.auth.cookieName}_trusted`;
const GOOD_CODE = "123456";

async function main(): Promise<void> {
  const users = {
    marta: { id: "user_marta", orgId: ORG_ID, email: "marta@example.com", twoFactorEnabled: true, twoFactorMethod: "totp" },
    sam: { id: "user_sam", orgId: ORG_ID, email: "sam@example.com", twoFactorEnabled: true, twoFactorMethod: "totp" },
  };
  const hashes: Record<string, string> = {
    user_marta: await bcrypt.hash("marta-password", 4),
    user_sam: await bcrypt.hash("sam-password", 4),
  };
  const secrets: Record<string, string> = { user_marta: "enc:secret-1", user_sam: "enc:secret-2" };

  const store = {
    findUserByEmail: async (email: string) => Object.values(users).find((u) => u.email === email),
    getUserForAuth: async (id: string) => Object.values(users).find((u) => u.id === id),
    getPasswordHash: async (id: string) => hashes[id],
    getTwoFactor: async (id: string) => ({
      enabled: true,
      method: "totp",
      totpSecret: secrets[id] ?? null,
      emailCodeHash: null,
      emailCodeExpires: null,
    }),
    me: async (id: string) => ({ user: Object.values(users).find((u) => u.id === id) }),
  } as unknown as Store;
  const sessions = { create: async () => "sess_1" } as unknown as SessionService;
  const twoFactor = {
    verifyChallenge: async (_id: string, code: string) => code === GOOD_CODE,
    sendEmailCode: async () => {},
  } as unknown as TwoFactorService;

  const auth = new AuthService(store);
  const controller = new AuthController(auth, sessions, twoFactor, store, {} as Mailer);

  /** A browser: a cookie jar that carries across calls. */
  function browser() {
    const jar: Record<string, string> = {};
    const maxAges: Record<string, number | undefined> = {};
    const res = {
      cookie: (name: string, value: string, opts?: { maxAge?: number }) => {
        jar[name] = value;
        maxAges[name] = opts?.maxAge;
      },
      clearCookie: (name: string) => {
        delete jar[name];
      },
    } as unknown as Response;
    const req = () => ({ headers: {}, socket: {}, cookies: { ...jar } }) as unknown as Request;
    return {
      jar,
      maxAges,
      login: (email: string, password: string) =>
        controller.login({ email, password }, req(), res) as Promise<Record<string, unknown>>,
      code: (code: string, rememberDevice?: boolean) =>
        controller.loginTwoFactor({ code, rememberDevice }, req(), res) as Promise<Record<string, unknown>>,
    };
  }

  const isChallenge = (r: Record<string, unknown>) => r.twoFactorRequired === true;
  const isSession = (r: Record<string, unknown>) => !!r.user && !r.twoFactorRequired;

  console.log("\nA browser that does not ask to be remembered\n");
  const plain = browser();
  ok("is asked for the code", isChallenge(await plain.login("marta@example.com", "marta-password")));
  ok("signs in with it", isSession(await plain.code(GOOD_CODE)));
  ok("and is not remembered", plain.jar[TRUSTED_COOKIE] === undefined);
  ok("so it is asked again next time", isChallenge(await plain.login("marta@example.com", "marta-password")));

  console.log("\nA browser that ticks Remember this device\n");
  const laptop = browser();
  await laptop.login("marta@example.com", "marta-password");
  ok("signs in with the code", isSession(await laptop.code(GOOD_CODE, true)));
  const trusted = laptop.jar[TRUSTED_COOKIE];
  ok("is given a remembered-device cookie", !!trusted);
  ok(
    "that lasts 30 days",
    laptop.maxAges[TRUSTED_COOKIE] === TRUSTED_DEVICE_TTL_S * 1000,
    String(laptop.maxAges[TRUSTED_COOKIE]),
  );
  const again = await laptop.login("marta@example.com", "marta-password");
  ok("and next time goes straight in, with no code", isSession(again), JSON.stringify(Object.keys(again)));

  console.log("\nWhat a remembered device still cannot do\n");
  let refused = false;
  try {
    await laptop.login("marta@example.com", "wrong-password");
  } catch {
    refused = true;
  }
  ok("skip the password", refused);
  ok("be used as a session", auth.verify(trusted) === undefined);
  ok("be used as a pending 2FA token", auth.verifyPending(trusted) === undefined);

  const shared = browser();
  shared.jar[TRUSTED_COOKIE] = trusted;
  ok(
    "vouch for somebody else's account",
    isChallenge(await shared.login("sam@example.com", "sam-password")),
  );

  const expired = jwt.sign(
    { sub: "user_marta", trust: "x", exp: Math.floor(Date.now() / 1000) - 60 },
    env.auth.jwtSecret,
  );
  const old = browser();
  old.jar[TRUSTED_COOKIE] = expired;
  ok("outlast its 30 days", isChallenge(await old.login("marta@example.com", "marta-password")));

  const forged = jwt.sign({ sub: "user_marta", trust: "guessed" }, "not-our-secret");
  const fake = browser();
  fake.jar[TRUSTED_COOKIE] = forged;
  ok("be forged", isChallenge(await fake.login("marta@example.com", "marta-password")));

  console.log("\nChanging the password or the second factor forgets every device\n");
  hashes.user_marta = await bcrypt.hash("new-marta-password", 4);
  ok(
    "a new password asks for the code again",
    isChallenge(await laptop.login("marta@example.com", "new-marta-password")),
  );
  await laptop.code(GOOD_CODE, true);
  ok("and can be remembered afresh", isSession(await laptop.login("marta@example.com", "new-marta-password")));

  secrets.user_marta = "enc:secret-rotated";
  ok(
    "a new authenticator asks for the code again",
    isChallenge(await laptop.login("marta@example.com", "new-marta-password")),
  );

  console.log("\nA phone, which has no cookies\n");
  const phoneLogin = (trustedDeviceToken?: string) =>
    controller.login(
      { email: "sam@example.com", password: "sam-password", tokenAuth: true, trustedDeviceToken },
      { headers: {}, socket: {}, cookies: {} } as unknown as Request,
      {} as Response,
    ) as Promise<Record<string, unknown>>;
  const first = await phoneLogin();
  ok("is asked for the code", isChallenge(first));
  const granted = (await controller.loginTwoFactor(
    { code: GOOD_CODE, pendingToken: first.pendingToken as string, tokenAuth: true, rememberDevice: true },
    { headers: {}, socket: {}, cookies: {} } as unknown as Request,
    { clearCookie: () => {} } as unknown as Response,
  )) as Record<string, unknown>;
  ok("is handed its pass in the response", typeof granted.trustedDeviceToken === "string");
  const phoneAgain = await phoneLogin(granted.trustedDeviceToken as string);
  ok("and with it goes straight in", isSession(phoneAgain) && typeof phoneAgain.token === "string");

  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// As a request would: inside the workspace under test (see tenancy/tenant-scope.ts).
void runInTenant(ORG_ID, main);