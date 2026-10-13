/**
 * A Gmail channel that Google has signed out, against the in-memory store with
 * Google faked at the network.
 *
 *   A  a refused refresh marks the mailbox signed out — once — with the reason,
 *      tells the admins and managers (not the agents), and reads as not connected;
 *   B  after that nothing asks Google again: the token call fails at once, the
 *      poll skips it, a send fails straight away with "needs reconnecting";
 *   C  a Gmail call refused for the sign-in (401, a scope taken away) marks it
 *      too; a quota refusal doesn't;
 *   D  reconnecting signs that channel in again in place: the same mailbox
 *      only, the conversations and settings kept, and it catches up on the
 *      mail it missed from where it stopped rather than starting from now;
 *   E  only managers and admins can start a connection;
 *   F  a mailbox out for longer than Gmail keeps its history has the gap swept
 *      by date — from a day before it was signed out, oldest first, received
 *      and sent — unless whoever reconnects chooses to start from now; and a
 *      connected mailbox can be asked to bring in what it had since a date.
 *
 *     pnpm check:gmail-reauth
 */
import type { Request, Response } from "express";
import { GmailSyncService } from "../apps/api/src/channels/google/gmail-sync.service";
import { GmailProvider } from "../apps/api/src/channels/google/gmail.provider";
import { GmailApiError, GmailAuthError } from "../apps/api/src/channels/google/gmail-api";
import { GMAIL_CONFIG, GoogleOAuthService } from "../apps/api/src/channels/google/google-oauth.service";
import { GoogleController } from "../apps/api/src/channels/google/google.controller";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import type { Inbox } from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function threw<T>(p: Promise<T>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err;
  }
}

/* ---- Google, faked at the network ---- */

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;
let route: Route = () => undefined;
const calls: string[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push(url);
  const hit = route(url, init) ?? { status: 404, body: { error: { message: `no fake for ${url}` } } };
  const text = typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body);
  return new Response(text, { status: hit.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/** A popup's answer, read back out of the page the callback renders. */
function popup(): { res: Response; result: () => { ok: boolean; error?: string; reconnected?: boolean } } {
  let html = "";
  const res = {
    status() {
      return res;
    },
    set() {
      return res;
    },
    type() {
      return res;
    },
    setHeader() {
      return res;
    },
    send(body: string) {
      html = body;
      return res;
    },
    redirect(_code: number, to: string) {
      html = `REDIRECT ${to}`;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    result: () => {
      const m = /var msg = (\{.*?\});/s.exec(html);
      return m ? JSON.parse(m[1]!) : { ok: html.startsWith("REDIRECT"), error: html };
    },
  };
}
const req = { headers: { host: "app.example.com" }, protocol: "https", get: () => "app.example.com" } as unknown as Request;

async function main() {
  delete process.env.GOOGLE_OAUTH_MOCK;
  const store = new MemoryStore();
  const bells: Array<{ userId: string; type: string; title: string }> = [];
  const notifications = {
    create: async (userId: string, n: { type: string; title: string }) => {
      bells.push({ userId, type: n.type, title: n.title });
    },
  } as unknown as NotificationsService;
  const google = new GoogleOAuthService(store, notifications);
  // Mail handed on as live mail is, in the order it was.
  const ingested: string[] = [];
  const ingest = {
    ingestEmail: async (m: { subject?: string }) => {
      ingested.push(`in:${m.subject}`);
      return {};
    },
    ingestOutboundEmail: async (m: { subject?: string }) => {
      ingested.push(`out:${m.subject}`);
      return {};
    },
  };
  const sync = new GmailSyncService(store, ingest as never, google, {} as never);
  const provider = new GmailProvider(google, store, {} as never);
  const controller = new GoogleController(google, store, sync, new SandboxPolicy(store));

  await runInTenant(ORG_ID, async () => {
    await store.setPlatformSetting("google_client_id", "client-id");
    await store.setPlatformSetting("google_client_secret", "client-secret");
    const inbox = await store.createInbox({
      orgId: ORG_ID,
      type: "email",
      name: "Support",
      handle: "help@swiftee.co.uk",
      teamIds: ["team_support"],
      routingStrategy: "round_robin",
      channelConfig: {
        provider: "gmail",
        email: "help@swiftee.co.uk",
        providerToken: "old-token",
        tokenExpiry: new Date(Date.now() - 60_000).toISOString(),
        refreshToken: "old-refresh",
        historyId: "100",
      },
    });
    const config = async () => (await store.getInboxConfig(inbox.id)) ?? {};
    const fresh = async () => (await store.listInboxes()).find((i) => i.id === inbox.id) as Inbox;

    console.log("\nA — Google signs the mailbox out\n");
    ok("connected to begin with", (await fresh()).connected === true && !(await fresh()).signedOut);
    route = (url) => (url.includes("oauth2.googleapis.com/token") ? { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } : undefined);
    const err = await threw(google.accessTokenForInbox(inbox, await config()));
    ok("the refused refresh is a sign-in problem, not a blip", err instanceof GmailAuthError, String(err));
    const now = await fresh();
    ok("the channel says it's signed out, and why", !!now.signedOut && /signed this mailbox out/.test(now.signedOut.reason) && !!now.signedOut.since, JSON.stringify(now.signedOut));
    ok("and no longer reads as connected", now.connected === false);
    ok("the admins and managers are told — not the agents", bells.length === 1 && bells[0]!.userId === DEMO_USER_ID && bells[0]!.type === "channel_reauth" && bells[0]!.title === "Support needs reconnecting", JSON.stringify(bells));

    console.log("\nB — and then it stops asking\n");
    calls.length = 0;
    const again = await threw(google.accessTokenForInbox(inbox, await config()));
    ok("the next token call fails at once, without asking Google", again instanceof GmailAuthError && calls.length === 0);
    ok("nobody is told twice", bells.length === 1);
    calls.length = 0;
    await sync.syncAll();
    ok("the poll leaves it alone", calls.length === 0, calls.join(", "));
    const sent = await provider.sendText({
      conversation: { id: "conv_x", inboxId: inbox.id } as never,
      to: "customer@example.com",
      body: "Hello",
    } as never);
    ok("a reply fails straight away, saying it needs reconnecting — no retries", !sent.ok && sent.errorCode === "reauth_required" && sent.retryable === false, JSON.stringify(sent));

    console.log("\nC — refusals mid-call\n");
    const other = await store.createInbox({
      orgId: ORG_ID,
      type: "email",
      name: "Hello",
      handle: "hello@swiftee.co.uk",
      teamIds: [],
      routingStrategy: "manual",
      channelConfig: { provider: "gmail", email: "hello@swiftee.co.uk", providerToken: "t", refreshToken: "r", tokenExpiry: new Date(Date.now() + 3600_000).toISOString() },
    });
    await google.noteFailure(other, new GmailApiError(403, "User-rate limit exceeded"));
    ok("a quota refusal leaves it connected", (await store.getInboxConfig(other.id))?.[GMAIL_CONFIG.authError] === undefined);
    await google.noteFailure(other, new GmailApiError(403, "Request had insufficient authentication scopes."));
    ok("a scope taken away marks it", /permission/.test((await store.getInboxConfig(other.id))?.[GMAIL_CONFIG.authError] ?? ""));
    const third = await store.createInbox({
      orgId: ORG_ID,
      type: "email",
      name: "Sales",
      handle: "sales@swiftee.co.uk",
      teamIds: [],
      routingStrategy: "manual",
      channelConfig: { provider: "gmail", email: "sales@swiftee.co.uk", providerToken: "t", tokenExpiry: new Date(Date.now() - 1).toISOString() },
    });
    ok("no saved refresh token is a sign-in problem too", (await threw(google.accessTokenForInbox(third, (await store.getInboxConfig(third.id)) ?? {}))) instanceof GmailAuthError);

    console.log("\nD — reconnecting, in place\n");
    const conversations = (await store.listConversations("all", DEMO_USER_ID)).items.length;
    const { res: startRes, result: started } = popup();
    await controller.start(DEMO_USER_ID, req, startRes, inbox.id);
    const startedTo = String(started().error ?? "");
    ok("Reconnect goes to Google, offering that mailbox", startedTo.includes("accounts.google.com") && startedTo.includes("login_hint=help%40swiftee.co.uk"), startedTo.slice(0, 120));
    const state = new URL(startedTo.replace(/^REDIRECT /, "")).searchParams.get("state")!;

    // Signed in as someone else: refused, and the channel left as it was.
    route = (url) => {
      if (url.includes("oauth2.googleapis.com/token")) return { status: 200, body: { access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 } };
      if (url.includes("userinfo")) return { status: 200, body: { email: "nathan@gmail.com" } };
      return undefined;
    };
    const wrong = popup();
    await controller.callback("code", state, req, wrong.res);
    ok("signing in as a different account is refused", wrong.result().ok === false && /You signed in as nathan@gmail.com, but this channel is help@swiftee.co.uk/.test(wrong.result().error ?? ""), wrong.result().error);
    ok("…and leaves it signed out", !!(await fresh()).signedOut);

    calls.length = 0;
    route = (url) => {
      if (url.includes("oauth2.googleapis.com/token")) return { status: 200, body: { access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 } };
      if (url.includes("userinfo")) return { status: 200, body: { email: "Help@swiftee.co.uk" } };
      if (url.includes("/history")) return { status: 200, body: { history: [], historyId: "150" } };
      if (url.includes("/profile")) return { status: 200, body: { emailAddress: "help@swiftee.co.uk", historyId: "999" } };
      return undefined;
    };
    const back = popup();
    await controller.callback("code", state, req, back.res);
    const after = await fresh();
    const cfg = await config();
    ok("the same mailbox signs back in", back.result().ok === true && back.result().reconnected === true, JSON.stringify(back.result()));
    ok("connected again, the warning gone", after.connected === true && !after.signedOut);
    ok("with the new sign-in", cfg[GMAIL_CONFIG.accessToken] === "new-token" && cfg[GMAIL_CONFIG.refreshToken] === "new-refresh");
    ok("the same channel: its id, name, routing kept", after.id === inbox.id && after.name === "Support" && after.routingStrategy === "round_robin" && after.teamIds.join() === "team_support");
    ok("no new channel made", (await store.listInboxes()).filter((i) => i.handle.toLowerCase() === "help@swiftee.co.uk").length === 1);
    ok("its conversations are all still there", (await store.listConversations("all", DEMO_USER_ID)).items.length === conversations);
    ok(
      "it catches up from where it stopped — not from now",
      calls.some((u) => u.includes("/history") && u.includes("startHistoryId=100")) && !calls.some((u) => u.includes("/profile")) && cfg[GMAIL_CONFIG.historyId] === "150",
      `${calls.filter((u) => u.includes("gmail")).join(", ")} → ${cfg[GMAIL_CONFIG.historyId]}`,
    );
    calls.length = 0;
    await sync.syncAll();
    ok("and the poll picks it up again", calls.some((u) => u.includes("/history")));

    console.log("\nF — a long time signed out\n");
    const DAY = 24 * 60 * 60 * 1000;
    const signOut = async (daysAgo: number) =>
      store.updateInbox(inbox.id, {
        channelConfig: {
          [GMAIL_CONFIG.authError]: "Google signed this mailbox out",
          [GMAIL_CONFIG.authErrorAt]: new Date(Date.now() - daysAgo * DAY).toISOString(),
          [GMAIL_CONFIG.historyId]: "150",
        },
      });
    const mail = (id: string, subject: string, labels: string[], from = "Dana <dana@acme.test>") => ({
      id,
      threadId: `t_${id}`,
      labelIds: labels,
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: from },
          { name: "To", value: "help@swiftee.co.uk" },
          { name: "Subject", value: subject },
          { name: "Message-ID", value: `<${id}@acme.test>` },
        ],
        body: { data: Buffer.from(`About ${subject}`).toString("base64url") },
      },
    });
    const box = {
      m1: mail("m1", "First", ["INBOX"]),
      m2: mail("m2", "Our reply", ["SENT"], "Support <help@swiftee.co.uk>"),
      m3: mail("m3", "Third", ["INBOX", "UNREAD"]),
    };
    const gmailFake = (expired: boolean) => (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) return { status: 200, body: { access_token: "new-token", expires_in: 3600 } };
      if (url.includes("userinfo")) return { status: 200, body: { email: "help@swiftee.co.uk" } };
      if (url.includes("/history")) return expired ? { status: 404, body: { error: { message: "Requested entity was not found." } } } : { status: 200, body: { history: [], historyId: "160" } };
      if (url.includes("/profile")) return { status: 200, body: { emailAddress: "help@swiftee.co.uk", historyId: "2000" } };
      if (url.includes("/messages?")) return { status: 200, body: { messages: [{ id: "m3" }, { id: "m2" }, { id: "m1" }] } };
      const one = /\/messages\/(m\d)\?/.exec(url)?.[1] as keyof typeof box | undefined;
      if (one) return { status: 200, body: box[one] };
      return undefined;
    };
    const reconnect = async (missed?: string) => {
      const { res, result } = popup();
      await controller.start(DEMO_USER_ID, req, res, inbox.id, missed);
      const st = new URL(String(result().error).replace(/^REDIRECT /, "")).searchParams.get("state")!;
      const cb = popup();
      await controller.callback("code", st, req, cb.res);
      return cb.result();
    };

    await signOut(10);
    calls.length = 0;
    ingested.length = 0;
    route = gmailFake(true);
    const tenDays = await reconnect();
    ok("out for ten days, it still signs back in", tenDays.ok === true, JSON.stringify(tenDays));
    await sync.sweepDone(inbox.id);
    const listed = calls.find((u) => u.includes("/messages?"));
    const q = listed ? new URL(listed).searchParams.get("q") ?? "" : "";
    const afterSec = Number(/after:(\d+)/.exec(q)?.[1]);
    ok("Gmail's history no longer reaching back, it starts the cursor from now", (await config())[GMAIL_CONFIG.historyId] === "2000");
    ok(
      "…and sweeps the gap by date, from a day before the sign-out",
      Math.abs(afterSec * 1000 - (Date.now() - 11 * DAY)) < 60_000 && q.includes("in:inbox") && q.includes("in:sent"),
      q,
    );
    ok("bringing in what was received and sent, oldest first, as live mail", ingested.join() === "in:First,out:Our reply,in:Third", ingested.join());

    await signOut(2);
    calls.length = 0;
    ingested.length = 0;
    route = gmailFake(false);
    await reconnect();
    await sync.sweepDone(inbox.id);
    ok("out for two days, the history covers it: no sweep", calls.some((u) => u.includes("/history")) && !calls.some((u) => u.includes("/messages?")));

    await signOut(10);
    calls.length = 0;
    ingested.length = 0;
    route = gmailFake(true);
    const fresh2 = await reconnect("skip");
    await sync.sweepDone(inbox.id);
    ok(
      "choosing to start from now skips the gap: no history, no sweep",
      fresh2.ok === true && !calls.some((u) => u.includes("/history") || u.includes("/messages?")) && calls.some((u) => u.includes("/profile")) && ingested.length === 0,
      calls.filter((u) => u.includes("gmail")).join(", "),
    );

    // Later, by hand: bring in what it had since a date.
    calls.length = 0;
    ingested.length = 0;
    const since = new Date(Date.now() - 5 * DAY).toISOString();
    const asked = await controller.pullMissed(DEMO_USER_ID, inbox.id, { since });
    await sync.sweepDone(inbox.id);
    ok("a manager can bring in a connected mailbox's mail since a date", asked.ok === true && ingested.length === 3, ingested.join());
    ok("an agent can't", (await threw(controller.pullMissed("usr_james", inbox.id, { since }))) instanceof Error);
    ok("nor from the future, or past 90 days", !!(await threw(controller.pullMissed(DEMO_USER_ID, inbox.id, { since: new Date(Date.now() + DAY).toISOString() }))) && !!(await threw(controller.pullMissed(DEMO_USER_ID, inbox.id, { since: new Date(Date.now() - 120 * DAY).toISOString() }))));
    await signOut(1);
    ok("nor while it's signed out — reconnect first", /Reconnect the mailbox first/.test(String(await threw(controller.pullMissed(DEMO_USER_ID, inbox.id, { since })))));

    console.log("\nE — who can connect\n");
    const agent = popup();
    await controller.start("usr_james", req, agent.res);
    ok("an agent can't start a Google connection", agent.result().ok === false && /managers and admins/.test(agent.result().error ?? ""));
    const gone = popup();
    await controller.start(DEMO_USER_ID, req, gone.res, "inbox_nope");
    ok("nor reconnect a channel that isn't there", gone.result().ok === false && /no longer exists/.test(gone.result().error ?? ""));
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall Gmail reconnect checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
