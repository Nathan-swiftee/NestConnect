/**
 * One person in several workspaces, and the platform's owners — through a
 * running API on a real Postgres.
 *
 *   A  An owner (an admin of the platform's own workspace) sees every
 *      workspace and makes a new one with its first admin, who is invited.
 *      A manager there is no owner: no list, no new workspaces, and the
 *      platform-wide integrations are read-only switches to them.
 *   B  The invite is accepted in a browser still signed in to the platform's
 *      workspace — the cookie mustn't get in the way — and the new admin is in
 *      the new workspace only, seeing nothing of anyone else's.
 *   C  Added to that workspace too, the owner signs in once with one password,
 *      lists both, switches between them, and lands next time where they were.
 *      Switching ends the old session.
 *   D  An owner can open a workspace they aren't in: it adds them as an admin,
 *      in its people list. Nobody else can switch into a workspace that isn't theirs.
 *   E  A new workspace whose admin already signs in somewhere joins them, with no
 *      invite; a password change reaches every workspace's sessions.
 *   F  A new workspace's email comes through Gmail, not a hosted address.
 *
 *     DATABASE_URL=… TENANT_HTTP_URL=http://localhost:3011 pnpm check:workspaces-http
 *
 * Same API requirements as check:tenant-http (dev mode, 2FA off). Creates and
 * removes its own rows (emails `wsh-…`, workspaces named `wsh …`).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PLATFORM_ORG_ID } from "../apps/api/src/tenancy/platform";

const BASE = (process.env.TENANT_HTTP_URL ?? "http://localhost:3011").replace(/\/+$/, "");
const PASSWORD = "wsh-password-1";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** A browser: keeps the session cookie between calls. */
class Browser {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [name, value] = pair!.split("=");
      const jar = new Map(this.cookie ? this.cookie.split("; ").map((p) => p.split("=") as [string, string]) : []);
      if (value) jar.set(name!, value);
      else jar.delete(name!);
      this.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json, text };
  }
  login(email: string, password = PASSWORD) {
    return this.call("POST", "/auth/login", { email, password });
  }
}

async function main(): Promise<void> {
  const root = new PrismaClient();
  await root.$connect();
  await cleanup(root);

  await root.organization.upsert({ where: { id: PLATFORM_ORG_ID }, create: { id: PLATFORM_ORG_ID, name: "Platform" }, update: {} });
  const hash = bcrypt.hashSync(PASSWORD, 8);
  // Made the way a script makes people (straight into the table): signing in
  // has to pick them up too.
  const owner = await root.user.create({ data: { orgId: PLATFORM_ORG_ID, name: "wsh Owner", email: "wsh-owner@example.com", role: "admin", passwordHash: hash } });
  await root.user.create({ data: { orgId: PLATFORM_ORG_ID, name: "wsh Manager", email: "wsh-manager@example.com", role: "manager", passwordHash: hash } });

  const own = new Browser();
  const mgr = new Browser();
  console.log("\nA — owners and workspaces\n");
  ok("the owner signs in", (await own.login("wsh-owner@example.com")).status < 300);
  ok("the manager signs in", (await mgr.login("wsh-manager@example.com")).status < 300);
  const mine = await own.call("GET", "/auth/workspaces");
  ok("the owner is in one workspace, and owns the platform", mine.json?.workspaces?.length === 1 && mine.json?.platformOwner === true, mine.text);
  ok("the manager doesn't own it", (await mgr.call("GET", "/auth/workspaces")).json?.platformOwner === false);
  ok("…can't list every workspace", (await mgr.call("GET", "/platform/workspaces")).status === 403);
  ok("…or make one", (await mgr.call("POST", "/platform/workspaces", { name: "wsh nope", adminName: "x", adminEmail: "wsh-x@example.com" })).status === 403);
  ok("…or change the platform's integrations", (await mgr.call("PATCH", "/settings/integrations", { anthropic: { model: "x" } })).status === 403);
  const asSeen = await mgr.call("GET", "/settings/integrations");
  ok("…but sees what's switched on, without the details", asSeen.status === 200 && asSeen.json?.google?.redirectUri === "", asSeen.text.slice(0, 120));
  ok("the owner sees the details", (await own.call("GET", "/settings/integrations")).json?.google?.redirectUri !== "");

  const list = await own.call("GET", "/platform/workspaces");
  ok("the owner lists every workspace", list.status === 200 && list.json.some((w: any) => w.id === PLATFORM_ORG_ID && w.joined), String(list.status));
  const made = await own.call("POST", "/platform/workspaces", { name: "wsh Acme", adminName: "wsh Ada", adminEmail: "wsh-ada@example.com" });
  const acme = made.json?.workspace?.id as string;
  ok("…and makes one, with its first admin invited", made.status === 201 && !!acme && made.json.admin.invited && !!made.json.admin.inviteUrl, made.text.slice(0, 200));
  ok("…which they aren't in themselves", made.json?.workspace?.joined === false);
  const acmeRow = await root.user.findFirst({ where: { orgId: acme, email: "wsh-ada@example.com" }, include: { memberships: { include: { team: true } } } });
  ok("its admin is an admin there, on a first team", acmeRow?.role === "admin" && acmeRow.memberships.some((m) => m.team.name === "General"));

  console.log("\nB — the invite, opened in a browser signed in elsewhere\n");
  const token = new URL(made.json.admin.inviteUrl).searchParams.get("invite")!;
  const ada = new Browser();
  ada.cookie = own.cookie; // the owner's browser, still signed in to the platform's workspace
  const accepted = await ada.call("POST", "/auth/set-password", { token, password: PASSWORD });
  ok("setting the password works", accepted.status < 300, `${accepted.status} ${accepted.text.slice(0, 120)}`);
  ok("…and signs them in to the new workspace", accepted.json?.user?.orgId === acme);
  const adaPeople = await ada.call("GET", "/settings/people");
  ok("they see their own workspace's people only", adaPeople.status === 200 && adaPeople.json.every((p: any) => p.user?.orgId === acme || p.orgId === acme || !JSON.stringify(p).includes("wsh-owner")), adaPeople.text.slice(0, 160));
  ok("…and are in that one workspace", (await ada.call("GET", "/auth/workspaces")).json?.workspaces?.length === 1);
  ok("they aren't an owner", (await ada.call("GET", "/platform/workspaces")).status === 403);
  const acmeTeam = acmeRow!.memberships[0]!.teamId;
  const refusedEmail = await ada.call("POST", "/inboxes", { type: "email", name: "wsh hosted", handle: "wsh-hosted@example.com", teamIds: [acmeTeam], routingStrategy: "manual" });
  ok("their workspace's email goes through Gmail, not a hosted address", refusedEmail.status === 400 && /Gmail/.test(refusedEmail.text), refusedEmail.text.slice(0, 160));

  console.log("\nC — one person, two workspaces\n");
  const added = await ada.call("POST", "/settings/people", { name: "wsh Owner", email: "WSH-Owner@example.com", role: "agent", teamIds: [] });
  ok("adding someone who already signs in elsewhere joins them, no invite", added.status < 300 && added.json?.addedExisting === true && !added.json?.invite, added.text.slice(0, 160));
  ok("…once only", (await ada.call("POST", "/settings/people", { name: "again", email: "wsh-owner@example.com", role: "agent", teamIds: [] })).status === 409);
  const both = await own.call("GET", "/auth/workspaces");
  ok("the owner now lists both", both.json?.workspaces?.length === 2 && both.json.workspaces.find((w: any) => w.current)?.orgId === PLATFORM_ORG_ID, both.text);
  const before = own.cookie;
  const moved = await own.call("POST", "/auth/switch", { orgId: acme });
  ok("switching moves the session into the other workspace", moved.status < 300 && moved.json?.user?.orgId === acme, moved.text.slice(0, 120));
  ok("…as their place there (an agent)", moved.json?.user?.role === "agent");
  const there = await own.call("GET", "/auth/session");
  ok("…and every call after acts there", there.status === 200 && there.json?.user?.orgId === acme, there.text.slice(0, 120));
  const stale = new Browser();
  stale.cookie = before;
  ok("the old session ended", (await stale.call("GET", "/auth/session")).status === 401);
  const again = new Browser();
  const back = await again.login("wsh-owner@example.com");
  ok("one password signs in, to where they last were", back.status < 300 && back.json?.user?.orgId === acme, back.text.slice(0, 120));
  ok("…and they switch back", (await own.call("POST", "/auth/switch", { orgId: PLATFORM_ORG_ID })).json?.user?.orgId === PLATFORM_ORG_ID);

  console.log("\nD — opening a workspace you aren't in\n");
  const beta = (await own.call("POST", "/platform/workspaces", { name: "wsh Beta", adminName: "wsh Bea", adminEmail: "wsh-bea@example.com" })).json?.workspace?.id as string;
  ok("someone else can't switch into it", (await mgr.call("POST", "/auth/switch", { orgId: beta })).status === 404);
  ok("…nor into a workspace that doesn't exist", (await own.call("POST", "/auth/switch", { orgId: "wsh_no_such_org" })).status === 404);
  const opened = await own.call("POST", "/auth/switch", { orgId: beta });
  ok("the owner opens it, as an admin", opened.status < 300 && opened.json?.user?.orgId === beta && opened.json?.user?.role === "admin", opened.text.slice(0, 120));
  ok("…in its people list, for its admins to see", (await root.user.count({ where: { orgId: beta, email: "wsh-owner@example.com", role: "admin" } })) === 1);
  await own.call("POST", "/auth/switch", { orgId: PLATFORM_ORG_ID });

  console.log("\nE — an admin who already signs in; a password change\n");
  const gamma = await own.call("POST", "/platform/workspaces", { name: "wsh Gamma", adminName: "wsh Manager", adminEmail: "wsh-manager@example.com" });
  ok("a new workspace's admin who already signs in joins it with no invite", gamma.status === 201 && gamma.json.admin.invited === false && !gamma.json.admin.inviteUrl);
  ok("…and lists it among theirs", (await mgr.call("GET", "/auth/workspaces")).json?.workspaces?.length === 2);
  const inGamma = new Browser();
  await inGamma.login("wsh-manager@example.com");
  await inGamma.call("POST", "/auth/switch", { orgId: gamma.json.workspace.id });
  const changed = await mgr.call("POST", "/auth/change-password", { currentPassword: PASSWORD, newPassword: "wsh-password-2" });
  ok("changing the password works", changed.status < 300, changed.text.slice(0, 120));
  ok("…and signs out their session in the other workspace", (await inGamma.call("GET", "/auth/session")).status === 401);
  ok("…while this one stays", (await mgr.call("GET", "/auth/session")).status === 200);
  ok("the new password signs in", (await new Browser().login("wsh-manager@example.com", "wsh-password-2")).status < 300);
  ok("the old one doesn't", (await new Browser().login("wsh-manager@example.com")).status === 401);

  console.log("\nF — the platform's own workspace keeps hosted email\n");
  const ownTeam = await root.team.create({ data: { orgId: PLATFORM_ORG_ID, name: "wsh Team" } });
  const hosted = await own.call("POST", "/inboxes", { type: "email", name: "wsh hosted", handle: "wsh-hosted@example.com", teamIds: [ownTeam.id], routingStrategy: "manual" });
  ok("a hosted address can still be added there", hosted.status < 300, `${hosted.status} ${hosted.text.slice(0, 120)}`);

  await cleanup(root);
  await root.$disconnect();
  console.log(failed ? `\n${failed} failed` : "\nall workspace checks passed");
  process.exit(failed ? 1 : 0);
}

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = (await root.organization.findMany({ where: { name: { startsWith: "wsh " } }, select: { id: true } })).map((o) => o.id);
  const users = (await root.user.findMany({ where: { OR: [{ email: { startsWith: "wsh-", mode: "insensitive" } }, { orgId: { in: orgs } }] }, select: { id: true } })).map((u) => u.id);
  const inboxes = (await root.inbox.findMany({ where: { OR: [{ orgId: { in: orgs } }, { name: { startsWith: "wsh " } }] }, select: { id: true } })).map((i) => i.id);
  await root.inboxTeam.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.inbox.deleteMany({ where: { id: { in: inboxes } } });
  await root.device.deleteMany({ where: { userId: { in: users } } });
  await root.session.deleteMany({ where: { userId: { in: users } } });
  await root.notification.deleteMany({ where: { userId: { in: users } } });
  await root.chatMember.deleteMany({ where: { OR: [{ userId: { in: users } }, { room: { orgId: { in: orgs } } }] } });
  await root.chatMessage.deleteMany({ where: { room: { orgId: { in: orgs } } } });
  await root.chatRoom.deleteMany({ where: { orgId: { in: orgs } } });
  await root.teamMember.deleteMany({ where: { OR: [{ userId: { in: users } }, { team: { orgId: { in: orgs } } }] } });
  await root.user.deleteMany({ where: { id: { in: users } } });
  await root.login.deleteMany({ where: { email: { startsWith: "wsh-" } } });
  await root.teamMember.deleteMany({ where: { team: { name: { startsWith: "wsh " } } } });
  await root.team.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { name: { startsWith: "wsh " } }] } });
  await root.appSetting.deleteMany({ where: { orgId: { in: orgs } } });
  await root.organization.deleteMany({ where: { id: { in: orgs } } });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
