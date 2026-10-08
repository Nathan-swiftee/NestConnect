/**
 * The app-store reviewer's demo workspace (apps/api/prisma/reviewer-workspace.ts).
 *
 * A Google Play reviewer signs in to the real app, on the real API, with a
 * password and no phone. What that must never become is a way to see a real
 * business's conversations, or a way to message a real person. This pins both,
 * on Postgres:
 *
 *  - Provisioning: the workspace is a sandbox, its login is an agent, every
 *    contact is invented (Ofcom drama numbers, RFC 2606 domains), no channel
 *    holds a credential, re-running is safe, and it refuses to take over a real
 *    workspace or a real person's login. A real workspace is untouched by it.
 *  - Sending: a reply from the demo is simulated — the provider is never called
 *    — while the same send from a real workspace does reach its provider.
 *  - What else leaves the platform from it: app email, AI, connecting channels,
 *    changing the shared login — all off in the demo, all unchanged elsewhere.
 *  - Two-factor: enrolment is waived for the demo's login only.
 *
 * With REVIEWER_HTTP_URL set, the same again through a running API that
 * *requires* two-factor (AUTH_REQUIRE_2FA unset): the reviewer signs in and
 * works the inbox; a real workspace's account without 2FA is still stopped;
 * the reviewer can't reach a real workspace's ids.
 *
 *     DATABASE_URL=… pnpm check:reviewer-workspace
 *     DATABASE_URL=… REVIEWER_HTTP_URL=http://localhost:3012 pnpm check:reviewer-workspace
 *
 * It writes to the database (the demo workspace, and rows prefixed `rvchk`), so
 * it refuses any DATABASE_URL that isn't on this machine. The demo password it
 * sets is random, held in memory and never printed.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { io } from "socket.io-client";
import type { ModuleRef } from "@nestjs/core";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { PLATFORM_ORG_ID } from "../apps/api/src/tenancy/platform";
import { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import { ChannelDispatcher } from "../apps/api/src/channels/channel-dispatcher";
import { ChannelProvider, type SendParams, type SendResult } from "../apps/api/src/channels/channel-provider";
import type { MediaService } from "../apps/api/src/storage/media.service";
import { Mailer } from "../apps/api/src/mail/mailer.service";
import {
  provisionReviewerWorkspace,
  REVIEW_ORG_ID,
  REVIEW_USER_ID,
} from "../apps/api/prisma/reviewer-workspace";

const REAL = PLATFORM_ORG_ID;
const REVIEW_EMAIL = "reviewer-check@example.com";
const OWNER_EMAIL = "rvchk-owner@example.com";
const OWNER_PASSWORD = "rvchk-owner-password";
const HTTP = process.env.REVIEWER_HTTP_URL?.replace(/\/+$/, "");

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function rejects(fn: () => Promise<unknown>, match?: RegExp): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    return match ? match.test((err as Error).message) : true;
  }
}

/** Every number in the demo is in Ofcom's drama range; every address on a
 *  domain reserved for examples. */
const SYNTHETIC_PHONE = /^\+447700900\d{3}$/;
const SYNTHETIC_EMAIL = /@([a-z0-9-]+\.)*example\.(com|org|net)$/i;

/** A provider that records instead of sending — to see whether one is reached. */
class RecordingProvider extends ChannelProvider {
  readonly sent: SendParams[] = [];
  supports(): boolean {
    return true;
  }
  async sendText(params: SendParams): Promise<SendResult> {
    this.sent.push(params);
    return { ok: true, channelMsgId: `rec_${this.sent.length}`, simulated: false };
  }
}

/** How much of the real workspace there is — to show provisioning leaves it be. */
async function footprint(root: PrismaClient, orgId: string): Promise<string> {
  const conv = { conversation: { orgId } };
  const n = await Promise.all([
    root.user.count({ where: { orgId } }),
    root.team.count({ where: { orgId } }),
    root.inbox.count({ where: { orgId } }),
    root.contact.count({ where: { orgId } }),
    root.contactIdentity.count({ where: { orgId } }),
    root.conversation.count({ where: { orgId } }),
    root.message.count({ where: conv }),
    root.label.count({ where: { orgId } }),
    root.template.count({ where: { orgId } }),
    root.session.count({ where: { user: { orgId } } }),
  ]);
  const latest = await root.message.findFirst({ where: conv, orderBy: { createdAt: "desc" }, select: { id: true, body: true } });
  return `${n.join(",")}|${latest?.id ?? ""}|${latest?.body ?? ""}`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error("check:reviewer-workspace writes to the database — point DATABASE_URL at a local test database.");
    process.exit(2);
  }

  const root = new PrismaClient();
  await root.$connect();
  const store = new PrismaStore(root as unknown as PrismaService, new SecretEncryptionService());
  const sandbox = new SandboxPolicy(store);
  await cleanup(root);

  // A real workspace with a real-looking customer — on the *same* number one of
  // the demo's invented customers uses, the worst case for a mix-up.
  await root.organization.upsert({ where: { id: REAL }, create: { id: REAL, name: "Platform" }, update: {} });
  const ownerTeam = await root.team.create({ data: { orgId: REAL, name: "rvchk team" } });
  const owner = await root.user.create({
    data: {
      orgId: REAL, name: "rvchk owner", email: OWNER_EMAIL, role: "admin", passwordHash: bcrypt.hashSync(OWNER_PASSWORD, 8),
      memberships: { create: [{ teamId: ownerTeam.id }] },
    },
  });
  const realInbox = await root.inbox.create({
    data: {
      orgId: REAL, type: "whatsapp", name: "rvchk WA", handle: "rvchk_phone", routingStrategy: "manual",
      channelConfig: { phoneNumberId: "rvchk_phone" }, teams: { create: [{ teamId: ownerTeam.id }] },
    },
  });
  const realContact = await root.contact.create({
    data: {
      orgId: REAL, displayName: "rvchk real customer",
      identities: { create: [{ orgId: REAL, kind: "phone", value: "+447700900101", normalizedValue: "+447700900101" }] },
    },
  });
  const realConv = await root.conversation.create({
    data: {
      orgId: REAL, inboxId: realInbox.id, contactId: realContact.id, channel: "whatsapp", status: "open", seq: 1,
      lastActivityAt: new Date(), lastInboundAt: new Date(), preview: "rvchk private message",
      messages: { create: [{ seq: 1, direction: "in", authorType: "contact", authorName: "rvchk", body: "rvchk private message", channel: "whatsapp", status: "delivered" }] },
    },
  });

  console.log("\nProvisioning\n");
  ok(
    "won't take a login that belongs to a real workspace",
    await rejects(() => provisionReviewerWorkspace(root, { email: OWNER_EMAIL, passwordHash: "x" }), /already an account/),
  );
  const before = await footprint(root, REAL);
  // The password a reviewer would be handed. Random, in memory, never printed.
  const password = randomBytes(18).toString("base64url");
  const first = await provisionReviewerWorkspace(root, { email: REVIEW_EMAIL, passwordHash: bcrypt.hashSync(password, 8) });
  const org = await root.organization.findUnique({ where: { id: REVIEW_ORG_ID } });
  const login = await root.user.findUnique({ where: { id: REVIEW_USER_ID } });
  ok("the demo is its own workspace", first.orgId === REVIEW_ORG_ID && REVIEW_ORG_ID !== REAL);
  ok("flagged as a sandbox", org?.sandbox === true);
  ok("the real workspace is not", (await root.organization.findUnique({ where: { id: REAL } }))?.sandbox === false);
  ok("the login is an agent, not an admin", login?.role === "agent" && login.orgId === REVIEW_ORG_ID, login?.role);
  ok("with no second factor to be challenged for", login?.twoFactorEnabled === false && !login.totpSecret);
  ok("the real workspace is exactly as it was", (await footprint(root, REAL)) === before);

  const identities = await root.contactIdentity.findMany({ where: { orgId: REVIEW_ORG_ID } });
  const phones = identities.filter((i) => i.kind === "phone").map((i) => i.value);
  const emails = identities.filter((i) => i.kind === "email").map((i) => i.value);
  ok("there are sample customers", phones.length >= 3 && emails.length >= 3, `${phones.length} phones, ${emails.length} emails`);
  ok("every phone number is a reserved drama number", phones.every((p) => SYNTHETIC_PHONE.test(p)), phones.join(" "));
  ok("every address is on a reserved example domain", emails.every((e) => SYNTHETIC_EMAIL.test(e)), emails.join(" "));
  const inboxes = await root.inbox.findMany({ where: { orgId: REVIEW_ORG_ID } });
  const configKeys = inboxes.flatMap((i) => Object.keys((i.channelConfig ?? {}) as object));
  ok("no channel holds a credential", configKeys.every((k) => k === "widgetKey"), configKeys.join(",") || "none");
  ok("inbox addresses are invented too", inboxes.every((i) => i.type !== "email" || SYNTHETIC_EMAIL.test(i.handle ?? "")));
  const demoConvs = await root.conversation.findMany({ where: { orgId: REVIEW_ORG_ID }, include: { messages: true } });
  ok("there are sample conversations", demoConvs.length === first.conversations && demoConvs.length >= 4, String(demoConvs.length));
  ok(
    "every demo conversation is on the demo's own inboxes and contacts",
    demoConvs.every((c) => inboxes.some((i) => i.id === c.inboxId)) &&
      (await root.contact.count({ where: { id: { in: demoConvs.map((c) => c.contactId) }, NOT: { orgId: REVIEW_ORG_ID } } })) === 0,
  );
  ok("the real customer on the same number was not merged in", (await root.contact.findUnique({ where: { id: realContact.id } }))?.orgId === REAL);

  console.log("\nAtomic refresh failure\n");
  const snapshot = async () => JSON.stringify(await root.organization.findUnique({
    where: { id: REVIEW_ORG_ID }, include: { contacts: { orderBy: { id: "asc" } },
      inboxes: { orderBy: { id: "asc" } }, conversations: { orderBy: { id: "asc" }, include: { messages: { orderBy: { id: "asc" } } } },
      users: { orderBy: { id: "asc" }, include: { sessions: true, devices: true } } },
  }));
  await root.session.create({ data: { userId: REVIEW_USER_ID } });
  const beforeFailure = await snapshot();
  const faulty = root.$extends({ query: { inbox: { async create() { throw new Error("injected reviewer refresh failure"); } } } });
  ok("a mid-refresh failure is surfaced", await rejects(() => provisionReviewerWorkspace(faulty as unknown as PrismaClient,
    { email: REVIEW_EMAIL, passwordHash: "FAKE_ROTATED_HASH" }), /injected reviewer refresh failure/));
  ok("failed refresh rolls back samples, credentials and sessions", (await snapshot()) === beforeFailure);
  // Restore after the pre-fix RED run so the remaining assertions can execute.
  await provisionReviewerWorkspace(root, { email: REVIEW_EMAIL, passwordHash: login!.passwordHash! });

  console.log("\nRe-running it\n");
  const hashBefore = login?.passwordHash;
  await root.session.create({ data: { userId: REVIEW_USER_ID } });
  const again = await provisionReviewerWorkspace(root, { email: REVIEW_EMAIL });
  const loginAgain = await root.user.findUnique({ where: { id: REVIEW_USER_ID } });
  ok("refreshes the same data, no duplicates", again.conversations === first.conversations &&
    (await root.conversation.count({ where: { orgId: REVIEW_ORG_ID } })) === demoConvs.length &&
    (await root.user.count({ where: { orgId: REVIEW_ORG_ID } })) === 1);
  ok("keeps the password when not given one", loginAgain?.passwordHash === hashBefore && !again.passwordChanged);
  ok("and keeps the reviewer signed in", (await root.session.count({ where: { userId: REVIEW_USER_ID } })) === 1);
  ok("the real workspace is still exactly as it was", (await footprint(root, REAL)) === before);
  // A sample reply the reviewer typed last time is gone after a refresh.
  await root.message.create({ data: { conversationId: "rv_conv_alex", seq: 99, direction: "out", authorType: "user", authorName: "x", body: "rvchk typed by a reviewer", channel: "whatsapp", status: "sent" } });
  await provisionReviewerWorkspace(root, { email: REVIEW_EMAIL, passwordHash: bcrypt.hashSync(password, 8) });
  ok("a refresh clears what a previous reviewer typed", (await root.message.count({ where: { body: "rvchk typed by a reviewer" } })) === 0);
  ok("a new password signs every earlier session out", (await root.session.count({ where: { userId: REVIEW_USER_ID } })) === 0);
  await root.organization.update({ where: { id: REVIEW_ORG_ID }, data: { sandbox: false } });
  ok(
    "refuses to touch the workspace if it isn't a sandbox",
    await rejects(() => provisionReviewerWorkspace(root, { email: REVIEW_EMAIL }), /not a sandbox/),
  );
  await root.organization.update({ where: { id: REVIEW_ORG_ID }, data: { sandbox: true } });

  console.log("\nSending from the demo\n");
  const provider = new RecordingProvider();
  const dispatcher = new ChannelDispatcher([provider], store, {} as MediaService, sandbox);
  for (const id of ["rv_conv_alex", "rv_conv_jordan", "rv_conv_visitor"]) {
    const outcome = await runInTenant(REVIEW_ORG_ID, async () => {
      const conv = (await store.getConversation(id))!;
      const msg = { ...conv.messages[conv.messages.length - 1]!, id: `rvchk_${id}`, direction: "out" as const, body: "rvchk demo reply" };
      return dispatcher.attemptSend(conv, msg);
    });
    ok(`a reply to ${id} is reported sent, as a simulation`,
      outcome.ok && outcome.simulated && (outcome.channelMsgId ?? "").startsWith("sandbox_"));
  }
  ok("no provider was so much as called", provider.sent.length === 0, String(provider.sent.length));
  const control = await runInTenant(REAL, async () => {
    const conv = (await store.getConversation(realConv.id))!;
    const msg = { ...conv.messages[0]!, id: "rvchk_real", direction: "out" as const, body: "rvchk real reply" };
    return dispatcher.attemptSend(conv, msg);
  });
  ok("the same send from a real workspace does reach its provider",
    control.ok && !control.simulated && provider.sent.length === 1 && provider.sent[0]!.to === "+447700900101");

  console.log("\nEverything else that would leave the platform\n");
  const mailer = new Mailer(store, {} as ModuleRef, sandbox);
  const mail = await runInTenant(REVIEW_ORG_ID, () => mailer.sendMail({ to: "someone@example.com", subject: "rvchk", text: "rvchk", html: "<p>rvchk</p>" }));
  ok("no email is sent from the demo", mail.sent === false && /demo/.test(mail.error ?? ""), mail.error);
  for (const action of ["Connecting a channel", "Changing the demo account's sign-in", "Inviting people"]) {
    ok(`${action}: refused in the demo`, await runInTenant(REVIEW_ORG_ID, () => rejects(() => sandbox.assertLive(action), /demo workspace/)));
    ok(`${action}: allowed in a real workspace`, !(await runInTenant(REAL, () => rejects(() => sandbox.assertLive(action)))));
  }

  console.log("\nTwo-factor\n");
  const prior = process.env.AUTH_REQUIRE_2FA;
  delete process.env.AUTH_REQUIRE_2FA; // as in production: required
  ok("enrolment is waived for the demo", (await sandbox.twoFactorRequired(REVIEW_ORG_ID)) === false);
  ok("and still required for a real workspace", (await sandbox.twoFactorRequired(REAL)) === true);
  ok("and for a workspace that doesn't exist", (await sandbox.twoFactorRequired("rvchk_no_such_org")) === true);
  ok("and for a request with no workspace", (await sandbox.twoFactorRequired(undefined)) === true);
  if (prior === undefined) delete process.env.AUTH_REQUIRE_2FA;
  else process.env.AUTH_REQUIRE_2FA = prior;

  if (HTTP) await overHttp(root, password, owner.id, realConv.id, realContact.id, realInbox.id);
  else console.log("\n(REVIEWER_HTTP_URL not set — skipping the running-API checks)\n");

  await cleanup(root);
  await root.$disconnect();
  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

async function call(token: string | undefined, method: string, path: string, body?: unknown) {
  const res = await fetch(`${HTTP}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

async function overHttp(
  root: PrismaClient,
  password: string,
  ownerId: string,
  realConvId: string,
  realContactId: string,
  realInboxId: string,
): Promise<void> {
  console.log("\nThrough the running API (two-factor required)\n");
  const signIn = await call(undefined, "POST", "/auth/login", { email: REVIEW_EMAIL, password, tokenAuth: true });
  const token = signIn.json?.token as string | undefined;
  ok("the reviewer signs in with the password alone", signIn.status < 300 && !!token && !signIn.json?.twoFactorRequired, String(signIn.status));
  ok("and is told enrolment isn't required here", signIn.json?.twoFactorEnforced === false);
  ok("a wrong password is still refused", (await call(undefined, "POST", "/auth/login", { email: REVIEW_EMAIL, password: `${password}x`, tokenAuth: true })).status === 401);

  const upload = new FormData();
  upload.append("file", new Blob(["synthetic reviewer avatar"], { type: "image/png" }), "avatar.png");
  const uploadResponse = await fetch(`${HTTP}/api/media`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: upload,
  });
  ok("reviewer multipart uploads return a clear sandbox restriction",
    uploadResponse.status === 403 && (await uploadResponse.text()).includes("demo workspace"), String(uploadResponse.status));

  const ownerIn = await call(undefined, "POST", "/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD, tokenAuth: true });
  ok("a real workspace's account is told enrolment is required", ownerIn.json?.twoFactorEnforced === true);
  ok("and, without 2FA, is held at the enrolment gate", (await call(ownerIn.json?.token, "GET", "/conversations?view=all")).status === 403);

  const ids = new Set<string>();
  let text = "";
  for (const view of ["inbound", "mine", "unassigned", "all"]) {
    const r = await call(token, "GET", `/conversations?view=${view}`);
    text += r.text;
    for (const c of r.json?.items ?? []) ids.add(c.id);
  }
  ok("the reviewer sees the sample conversations", ids.size >= 4, String(ids.size));
  ok("and only those", [...ids].every((id) => id.startsWith("rv_conv_")) && !text.includes("rvchk"), [...ids].join(" "));
  const people = await call(token, "GET", "/settings/people");
  ok("the people list is the demo's own", !people.text.includes(OWNER_EMAIL) && !people.text.includes(ownerId));
  const inboxes = await call(token, "GET", "/inboxes");
  ok("the inbox list is the demo's own", !inboxes.text.includes(realInboxId));

  for (const [label, method, path, body] of [
    ["a real conversation", "GET", `/conversations/${realConvId}`],
    ["its messages", "GET", `/conversations/${realConvId}/messages`],
    ["a reply into it", "POST", `/conversations/${realConvId}/messages`, { body: "rvchk injected", internal: false }],
    ["a real contact", "GET", `/contacts/${realContactId}`],
    ["editing a real contact", "PATCH", `/contacts/${realContactId}`, { displayName: "rvchk hijacked" }],
  ] as [string, string, string, unknown?][]) {
    const r = await call(token, method, path, body);
    ok(`${label}: not found`, r.status === 404 && !r.text.includes("rvchk private"), String(r.status));
  }
  ok("nothing was written into the real workspace",
    (await root.message.count({ where: { conversationId: realConvId } })) === 1 &&
      (await root.contact.findUnique({ where: { id: realContactId } }))?.displayName === "rvchk real customer");

  const reply = await call(token, "POST", "/conversations/rv_conv_alex/messages", { body: "rvchk reviewer reply", internal: false });
  ok("the reviewer can reply", reply.status === 201, String(reply.status));
  let stored: { status: string; channelMsgId: string | null } | null = null;
  for (let i = 0; i < 20; i++) {
    stored = await root.message.findFirst({ where: { conversationId: "rv_conv_alex", body: "rvchk reviewer reply" }, select: { status: true, channelMsgId: true } });
    if (stored && stored.status !== "queued") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the reply shows as sent", !!stored && ["sent", "delivered", "read"].includes(stored.status), stored?.status);
  ok("by the simulation, not a provider", (stored?.channelMsgId ?? "").startsWith("sandbox_"), stored?.channelMsgId ?? "none");

  const socketOk = await new Promise<boolean>((done) => {
    const s = io(HTTP!, { auth: { token }, transports: ["websocket"], reconnection: false });
    let up = false;
    s.on("connect", () => {
      up = true;
      setTimeout(() => {
        done(s.connected);
        s.close();
      }, 700);
    });
    s.on("disconnect", () => up && done(false));
    s.on("connect_error", () => done(false));
  });
  ok("the live-updates socket stays connected", socketOk);

  for (const [label, method, path, body] of [
    ["changing the shared password", "POST", "/auth/change-password", { currentPassword: password, newPassword: "rvchk-a-new-password-1" }],
    ["setting up an authenticator", "POST", "/auth/2fa/totp/start", {}],
    ["setting up email codes", "POST", "/auth/2fa/email/start", {}],
    ["changing the profile", "PATCH", "/me/profile", { name: "rvchk" }],
    ["adding a channel", "POST", "/inboxes", { type: "email", name: "rvchk", handle: "rvchk@example.com", teamIds: ["rv_team_foh"] }],
    ["inviting someone", "POST", "/settings/people", { name: "rvchk", email: "rvchk-invite@example.com", role: "agent" }],
  ] as [string, string, string, unknown][]) {
    const r = await call(token, method, path, body);
    ok(`${label}: refused`, r.status === 403, String(r.status));
  }
  const meta = await call(token, "GET", "/channels/meta/oauth/start");
  ok("connecting WhatsApp: refused", meta.text.includes("demo workspace") && !meta.text.includes("facebook.com"), String(meta.status));
  const google = await call(token, "GET", "/channels/google/oauth/start");
  ok("connecting Gmail: refused", google.text.includes("demo workspace") && !google.text.includes("accounts.google.com"), String(google.status));
  ok("the password still works after all that",
    (await call(undefined, "POST", "/auth/login", { email: REVIEW_EMAIL, password, tokenAuth: true })).status < 300);

  const reset = await call(undefined, "POST", "/auth/forgot-password", { email: REVIEW_EMAIL });
  const login = await root.user.findUnique({ where: { id: REVIEW_USER_ID }, select: { inviteTokenHash: true } });
  ok("a reset request answers as usual but mints no link", reset.status < 300 && !login?.inviteTokenHash, String(reset.status));
}

/** The check's own rows in the real workspace. The demo workspace stays (it is
 *  what `reviewer:setup` would leave), minus anything the check typed into it. */
async function cleanup(root: PrismaClient): Promise<void> {
  const users = (await root.user.findMany({ where: { email: { startsWith: "rvchk-" } }, select: { id: true } })).map((u) => u.id);
  const inboxes = (await root.inbox.findMany({ where: { name: { startsWith: "rvchk" } }, select: { id: true } })).map((i) => i.id);
  const convs = (await root.conversation.findMany({ where: { inboxId: { in: inboxes } }, select: { id: true, contactId: true } }));
  const convIds = convs.map((c) => c.id);
  await root.message.deleteMany({ where: { OR: [{ conversationId: { in: convIds } }, { body: { startsWith: "rvchk" } }] } });
  await root.conversation.deleteMany({ where: { id: { in: convIds } } });
  const contacts = (await root.contact.findMany({ where: { displayName: { startsWith: "rvchk" } }, select: { id: true } })).map((c) => c.id);
  await root.contactIdentity.deleteMany({ where: { contactId: { in: contacts } } });
  await root.contact.deleteMany({ where: { id: { in: contacts } } });
  await root.inboxTeam.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.inbox.deleteMany({ where: { id: { in: inboxes } } });
  await root.device.deleteMany({ where: { userId: { in: users } } });
  await root.session.deleteMany({ where: { userId: { in: users } } });
  await root.notification.deleteMany({ where: { userId: { in: users } } });
  await root.teamMember.deleteMany({ where: { OR: [{ userId: { in: users } }, { team: { name: { startsWith: "rvchk" } } }] } });
  await root.user.deleteMany({ where: { id: { in: users } } });
  await root.team.deleteMany({ where: { name: { startsWith: "rvchk" } } });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
