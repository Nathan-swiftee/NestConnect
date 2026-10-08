/**
 * Tenant isolation through the front door.
 *
 * check:tenant-isolation pins the store. This pins everything in front of it,
 * against a running API on a real Postgres: the auth guard resolving the
 * workspace from the token, the interceptor binding it, the controllers, the
 * WhatsApp webhook choosing a workspace by the number a message was sent to,
 * the chat widget choosing one by its key, and the socket that streams events.
 *
 * Two workspaces — the platform's own (`org_swiftee`, as in production) and a
 * second — each get a signed-in admin and a channel. A customer writes to each.
 * Then each admin asks for everything they can, and aims requests at the other
 * workspace's ids. Nothing of the other's may come back; nothing may change.
 *
 *     DATABASE_URL=… TENANT_HTTP_URL=http://localhost:3011 pnpm check:tenant-http
 *
 * The API must run in dev mode (NODE_ENV≠production, AUTH_REQUIRE_2FA=false)
 * so the WhatsApp webhook accepts unsigned test traffic and the test admins
 * need no authenticator. It creates and removes its own rows (ids `isoh_…`).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { PLATFORM_ORG_ID } from "../apps/api/src/tenancy/platform";
import { ServerEvent } from "../packages/schemas/src/index";

const BASE = (process.env.TENANT_HTTP_URL ?? "http://localhost:3011").replace(/\/+$/, "");
const A = PLATFORM_ORG_ID;
const B = "isoh_org_b";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function call(token: string | undefined, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json: json as any, text };
}

const waMessage = (phoneNumberId: string, from: string, id: string, body: string) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "waba",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId, display_phone_number: phoneNumberId },
        contacts: [{ wa_id: from, profile: { name: "Same Customer" } }],
        messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
      },
    }],
  }],
});

async function main(): Promise<void> {
  const root = new PrismaClient();
  await root.$connect();
  await cleanup(root);

  // Two workspaces, each with an admin and a WhatsApp number + a chat widget.
  await root.organization.upsert({ where: { id: A }, create: { id: A, name: "Platform" }, update: {} });
  await root.organization.create({ data: { id: B, name: "Second workspace" } });
  const hash = bcrypt.hashSync("isoh-password", 8);
  const make = async (org: string, tag: string) => {
    const team = await root.team.create({ data: { orgId: org, name: `isoh ${tag} team` } });
    const user = await root.user.create({
      data: {
        orgId: org, name: `isoh ${tag}`, email: `isoh-${tag}@example.com`, role: "admin", passwordHash: hash,
        memberships: { create: [{ teamId: team.id }] },
      },
    });
    const wa = await root.inbox.create({
      data: {
        orgId: org, type: "whatsapp", name: `isoh ${tag} WA`, handle: `isoh_phone_${tag}`, routingStrategy: "manual",
        channelConfig: { phoneNumberId: `isoh_phone_${tag}` }, teams: { create: [{ teamId: team.id }] },
      },
    });
    const chat = await root.inbox.create({
      data: {
        orgId: org, type: "nestchat", name: `isoh ${tag} chat`, handle: `isoh-${tag}-chat`, routingStrategy: "manual",
        channelConfig: { widgetKey: `isoh_wk_${tag}` }, teams: { create: [{ teamId: team.id }] },
      },
    });
    return { team, user, wa, chat };
  };
  const a = await make(A, "a");
  const b = await make(B, "b");

  const login = async (email: string) =>
    (await call(undefined, "POST", "/auth/login", { email, password: "isoh-password", tokenAuth: true })).json?.token as string;
  const tokenA = await login("isoh-a@example.com");
  const tokenB = await login("isoh-b@example.com");
  console.log("\nSigning in\n");
  ok("A's admin signs in", !!tokenA);
  ok("B's admin signs in", !!tokenB);
  ok("each session knows its own workspace",
    (await call(tokenA, "GET", "/auth/session")).json?.user?.orgId === A &&
      (await call(tokenB, "GET", "/auth/session")).json?.user?.orgId === B);

  // Sockets, to see what each workspace is streamed.
  const seen: Record<"a" | "b", string[]> = { a: [], b: [] };
  const connect = (token: string, who: "a" | "b") =>
    new Promise<Socket>((resolve) => {
      const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
      s.on(ServerEvent.MessageCreated, (p: { message?: { body?: string } }) => seen[who].push(p.message?.body ?? ""));
      s.on("connect", () => resolve(s));
      s.on("connect_error", () => resolve(s));
    });
  const sockA = await connect(tokenA, "a");
  const sockB = await connect(tokenB, "b");

  // The same customer writes to both businesses, by WhatsApp and the widget.
  console.log("\nA customer writes to each business\n");
  const hookA = await call(undefined, "POST", "/channels/whatsapp/webhook", waMessage("isoh_phone_a", "447700900555", "wamid.isoh_a", "isoh A private message"));
  const hookB = await call(undefined, "POST", "/channels/whatsapp/webhook", waMessage("isoh_phone_b", "447700900555", "wamid.isoh_b", "isoh B private message"));
  ok("A's number accepts its webhook", hookA.status === 200, String(hookA.status));
  ok("B's number accepts its webhook", hookB.status === 200, String(hookB.status));
  const unmapped = await call(undefined, "POST", "/channels/whatsapp/webhook", waMessage("isoh_phone_nobody", "447700900555", "wamid.isoh_x", "isoh nobody"));
  ok("a number no workspace has is accepted and filed nowhere", unmapped.status === 200);

  const session = await call(undefined, "POST", "/nestchat/isoh_wk_b/session", {});
  const visitor = session.json?.token as string | undefined;
  ok("B's widget opens a session", !!visitor, String(session.status));
  const sent = await call(visitor, "POST", "/nestchat/message", { body: "isoh B widget message" });
  ok("a visitor writes on B's widget", sent.status === 201 || sent.status === 200, String(sent.status));
  await new Promise((r) => setTimeout(r, 600));

  // Where everything landed.
  const listAll = async (token: string) => {
    const ids = new Set<string>();
    const bodies: string[] = [];
    for (const view of ["inbound", "mine", "unassigned", "all"]) {
      const r = await call(token, "GET", `/conversations?view=${view}`);
      for (const c of r.json?.items ?? []) {
        ids.add(c.id);
        bodies.push(c.preview ?? "");
      }
    }
    return { ids, bodies };
  };
  const listA = await listAll(tokenA);
  const listB = await listAll(tokenB);
  const convA = (await root.conversation.findFirst({ where: { inboxId: a.wa.id } }))!;
  const convB = (await root.conversation.findFirst({ where: { inboxId: b.wa.id } }))!;
  const nobody = await root.message.findFirst({ where: { channelMsgId: "wamid.isoh_x" } });

  console.log("\nEach workspace sees its own, and only its own\n");
  ok("A's message landed in A's inbox", !!convA && convA.orgId === A);
  ok("B's message landed in B's inbox", !!convB && convB.orgId === B);
  ok("the same customer is a separate contact in each", convA.contactId !== convB.contactId);
  ok("the unmapped number's message was stored nowhere", !nobody);
  ok("A lists A's conversation", listA.ids.has(convA.id));
  ok("A lists none of B's", !listA.ids.has(convB.id) && !listA.bodies.some((p) => p.includes("isoh B")));
  ok("B lists B's conversation", listB.ids.has(convB.id));
  ok("B lists none of A's", !listB.ids.has(convA.id) && !listB.bodies.some((p) => p.includes("isoh A")));
  ok("A's socket was told about A's message", seen.a.some((m) => m.includes("isoh A private")));
  ok("A's socket heard nothing of B's", !seen.a.some((m) => m.includes("isoh B")));
  ok("B's socket heard nothing of A's", !seen.b.some((m) => m.includes("isoh A")));
  ok("B's socket was told about B's own", seen.b.some((m) => m.includes("isoh B")));

  console.log("\nB aims at A's ids\n");
  const contactA = convA.contactId;
  const notFound = async (label: string, method: string, path: string, body?: unknown) => {
    const r = await call(tokenB, method, path, body);
    const leaked = r.text.includes("isoh A private") || r.text.includes(convA.id) && method === "GET" && r.status === 200;
    ok(label, r.status >= 400 && !leaked, `${r.status}`);
  };
  await notFound("read A's conversation", "GET", `/conversations/${convA.id}`);
  await notFound("read A's messages", "GET", `/conversations/${convA.id}/messages`);
  await notFound("reply into A's conversation", "POST", `/conversations/${convA.id}/messages`, { body: "isoh injected", internal: false });
  await notFound("close A's conversation", "POST", `/conversations/${convA.id}/status`, { status: "closed" });
  await notFound("assign A's conversation", "POST", `/conversations/${convA.id}/assign`, { assigneeUserId: b.user.id });
  await notFound("label A's conversation", "POST", `/conversations/${convA.id}/labels`, { labelIds: [] });
  await notFound("read A's contact", "GET", `/contacts/${contactA}`);
  await notFound("edit A's contact", "PATCH", `/contacts/${contactA}`, { displayName: "isoh hijacked" });
  await notFound("delete A's contact", "DELETE", `/contacts/${contactA}`);
  await notFound("edit A's inbox", "PATCH", `/inboxes/${a.wa.id}`, { name: "isoh hijacked" });
  await notFound("delete A's inbox", "DELETE", `/inboxes/${a.chat.id}`);
  await notFound("edit A's admin", "PATCH", `/settings/people/${a.user.id}`, { role: "agent" });
  await notFound("delete A's admin", "DELETE", `/settings/people/${a.user.id}`);
  await notFound("edit A's team", "PATCH", `/settings/teams/${a.team.id}`, { name: "isoh hijacked" });
  const steal = await call(tokenB, "POST", `/inboxes`, {
    type: "whatsapp", name: "isoh stolen", handle: "isoh_phone_a", teamIds: [b.team.id], routingStrategy: "manual",
    channelConfig: { phoneNumberId: "isoh_phone_a" },
  });
  ok("connect A's WhatsApp number: refused as taken", steal.status === 409, `${steal.status} ${steal.json?.message ?? ""}`);
  const integ = await call(tokenB, "GET", "/settings/integrations");
  ok("platform integrations are closed to B", integ.status === 403, String(integ.status));
  const integA = await call(tokenA, "GET", "/settings/integrations");
  ok("…and open to the platform's own admin", integA.status === 200, String(integA.status));

  const people = await call(tokenB, "GET", "/settings/people");
  ok("B's people list has none of A's", Array.isArray(people.json) && !JSON.stringify(people.json).includes("isoh-a@"));
  const inboxes = await call(tokenB, "GET", "/inboxes");
  ok("B's channel list has none of A's", Array.isArray(inboxes.json) && !JSON.stringify(inboxes.json).includes(a.wa.id));
  const contacts = await call(tokenB, "GET", "/contacts");
  ok("B's contacts have none of A's", !JSON.stringify(contacts.json ?? "").includes(contactA));
  const search = await call(tokenB, "GET", `/conversations/search?q=${encodeURIComponent("isoh A private")}`);
  ok("B's search can't find A's message", !JSON.stringify(search.json ?? "").includes(convA.id));
  const diags = await call(tokenB, "GET", "/channels/diagnostics");
  ok("B doesn't see the operator's unmatched-webhook log", !JSON.stringify(diags.json ?? "").includes("isoh_phone_nobody"));

  // A, after all that.
  const afterA = await call(tokenA, "GET", `/conversations/${convA.id}`);
  ok("A's conversation is untouched", afterA.status === 200 && afterA.json?.status === "open" &&
    !JSON.stringify(afterA.json).includes("isoh injected"));
  ok("A's admin is still an admin", (await root.user.findUnique({ where: { id: a.user.id } }))?.role === "admin");
  ok("A's inboxes are still there", (await root.inbox.count({ where: { id: { in: [a.wa.id, a.chat.id] } } })) === 2);
  ok("A's contact keeps its name", (await root.contact.findUnique({ where: { id: contactA } }))?.displayName !== "isoh hijacked");
  ok("B could not take A's number", (await root.inbox.count({ where: { orgId: B, handle: "isoh_phone_a" } })) === 0);

  console.log("\nThe widget only reaches its own workspace\n");
  const otherVisitor = (await call(visitor, "GET", `/nestchat/conversations/${convA.id}/messages`));
  ok("B's visitor can't open A's conversation", otherVisitor.status >= 400 && !otherVisitor.text.includes("isoh A private"), String(otherVisitor.status));

  console.log("\nA thread's room is its own workspace's\n");
  // Room names are conversation ids; a socket asks to join one by naming it.
  const typingSeen: Record<"b" | "a2", number> = { b: 0, a2: 0 };
  const sockA2 = await connect(tokenA, "a");
  sockB.on(ServerEvent.Typing, (p: { conversationId?: string }) => { if (p.conversationId === convA.id) typingSeen.b++; });
  sockA2.on(ServerEvent.Typing, (p: { conversationId?: string }) => { if (p.conversationId === convA.id) typingSeen.a2++; });
  sockA.emit("conversation:join", { conversationId: convA.id });
  sockA2.emit("conversation:join", { conversationId: convA.id });
  sockB.emit("conversation:join", { conversationId: convA.id });
  await new Promise((r) => setTimeout(r, 400));
  sockA.emit("typing", { conversationId: convA.id, typing: true, who: "isoh A agent" });
  sockB.emit("typing", { conversationId: convA.id, typing: true, who: "isoh spoofed" });
  await new Promise((r) => setTimeout(r, 600));
  ok("A's colleague sees A typing on A's thread", typingSeen.a2 >= 1, String(typingSeen.a2));
  ok("B's socket, asking to join A's thread, sees nothing of it", typingSeen.b === 0, String(typingSeen.b));
  ok("…and can't type into it either", typingSeen.a2 === 1, String(typingSeen.a2));
  sockA2.close();

  console.log("\nThe rest of the request paths run inside their workspace\n");
  // Not isolation assertions as such: each of these reaches the store by a path
  // that has to establish its workspace first, and one that forgot would fail
  // with a 500 (the tenant-scoped client refuses to run unbound).
  const reply = await call(tokenB, "POST", `/conversations/${convB.id}/messages`, { body: "isoh B reply", internal: false });
  ok("an agent reply is accepted (and queued for delivery)", reply.status === 201, String(reply.status));
  await new Promise((r) => setTimeout(r, 1200));
  const replied = await call(tokenB, "GET", `/conversations/${convB.id}`);
  const replyMsg = (replied.json?.messages ?? []).find((m: { body: string }) => m.body === "isoh B reply");
  ok("…and the delivery attempt ran in B's workspace (left queued only if never attempted)",
    !!replyMsg && replyMsg.status !== "queued", replyMsg?.status);
  const note = await call(tokenB, "POST", `/conversations/${convB.id}/messages`, { body: "isoh B note", internal: true });
  ok("an internal note", note.status === 201, String(note.status));
  ok("snooze", (await call(tokenB, "POST", `/conversations/${convB.id}/snooze`, { until: new Date(Date.now() + 36e5).toISOString() })).status < 300);
  ok("mark read", (await call(tokenB, "POST", `/conversations/${convB.id}/read`)).status < 300);
  ok("counts", (await call(tokenB, "GET", "/conversations/counts?view=inbound")).status === 200);
  ok("views", (await call(tokenB, "GET", "/views")).status === 200);
  ok("labels", (await call(tokenB, "GET", "/labels")).status === 200);
  ok("me", (await call(tokenB, "GET", "/me")).status === 200);
  ok("sessions list", (await call(tokenB, "GET", "/auth/sessions")).status === 200);
  ok("2FA status", (await call(tokenB, "GET", "/auth/2fa/status")).status === 200);
  const pixel = await fetch(`${BASE}/api/track/open/isoh-unknown-token.gif`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh)" } });
  ok("email-open pixel for an unknown token still answers", pixel.status === 200, String(pixel.status));
  const mail = await call(undefined, "POST", "/channels/email/webhook", {
    From: "someone@example.org", To: "isoh-nobody@example.com", Subject: "hi", TextBody: "isoh mail", MessageID: "<isoh-mail@example.org>",
  });
  ok("inbound email to an address no workspace has is accepted and filed nowhere", mail.status < 300, String(mail.status));
  ok("visitor: own messages", (await call(visitor, "GET", "/nestchat/messages")).status === 200);
  ok("visitor: own conversations", (await call(visitor, "GET", "/nestchat/conversations")).status === 200);
  ok("visitor: typing", (await call(visitor, "POST", "/nestchat/typing", { typing: true, preview: "isoh" })).status < 300);
  const visitorNow = (sent.json?.token as string | undefined) ?? visitor;
  const read = await call(visitorNow, "POST", "/nestchat/read", { throughMessageId: replyMsg?.id ?? "none", status: "read" });
  ok("visitor: read receipt", read.status < 400, String(read.status));
  ok("widget config", (await call(undefined, "GET", "/nestchat/isoh_wk_b/config")).status === 200);
  ok("an unknown widget key is a 404, not a 500", (await call(undefined, "GET", "/nestchat/isoh_wk_nobody/config")).status === 404);
  const forged = await call("not-a-token", "GET", "/nestchat/messages");
  ok("a forged visitor token is refused", forged.status === 403, String(forged.status));

  sockA.close();
  sockB.close();
  await cleanup(root);
  await root.$disconnect();
  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

async function cleanup(root: PrismaClient): Promise<void> {
  const inboxes = (await root.inbox.findMany({ where: { OR: [{ name: { startsWith: "isoh " } }, { handle: { startsWith: "isoh" } }] }, select: { id: true } })).map((i) => i.id);
  const convs = (await root.conversation.findMany({ where: { inboxId: { in: inboxes } }, select: { id: true, contactId: true } }));
  const convIds = convs.map((c) => c.id);
  const msgs = (await root.message.findMany({ where: { conversationId: { in: convIds } }, select: { id: true } })).map((m) => m.id);
  await root.attachment.deleteMany({ where: { messageId: { in: msgs } } });
  await root.message.deleteMany({ where: { id: { in: msgs } } });
  for (const t of ["conversationLabel", "participant", "assignmentEvent", "note"] as const) {
    await (root[t] as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { conversationId: { in: convIds } } });
  }
  await root.customerDevice.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.conversation.deleteMany({ where: { id: { in: convIds } } });
  const contacts = [...new Set(convs.map((c) => c.contactId))];
  const visitorContacts = (await root.contactIdentity.findMany({ where: { orgId: "isoh_org_b" }, select: { contactId: true } })).map((c) => c.contactId);
  const allContacts = [...new Set([...contacts, ...visitorContacts, ...(await root.contact.findMany({ where: { orgId: "isoh_org_b" }, select: { id: true } })).map((c) => c.id)])];
  await root.contactIdentity.deleteMany({ where: { contactId: { in: allContacts } } });
  await root.contact.deleteMany({ where: { id: { in: allContacts } } });
  await root.inboxTeam.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.inbox.deleteMany({ where: { id: { in: inboxes } } });
  const users = (await root.user.findMany({ where: { email: { startsWith: "isoh-" } }, select: { id: true } })).map((u) => u.id);
  await root.notification.deleteMany({ where: { userId: { in: users } } });
  await root.device.deleteMany({ where: { userId: { in: users } } });
  await root.session.deleteMany({ where: { userId: { in: users } } });
  await root.teamMember.deleteMany({ where: { OR: [{ userId: { in: users } }, { team: { name: { startsWith: "isoh " } } }] } });
  await root.user.deleteMany({ where: { id: { in: users } } });
  await root.team.deleteMany({ where: { name: { startsWith: "isoh " } } });
  await root.webhookDiagnostic.deleteMany({ where: { reference: { startsWith: "isoh" } } });
  await root.organization.deleteMany({ where: { id: "isoh_org_b" } });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
