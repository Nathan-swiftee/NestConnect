/**
 * One chat per order, through the real endpoints.
 *
 * A channel can key its threads on a conversation field (`order_id`), so an
 * app opening the chat for order B gets B's conversation and not A's. Opening
 * already worked. Writing did not: `POST /nestchat/message` ignored the
 * session's conversation and joined the customer's most recent open one —
 * order A's — then wrote the session's fields onto it, relabelling A as B.
 * General support (no order) shared that thread too.
 *
 * Every step here goes through `appSession` and `send`, because the pieces were
 * right and the wiring was not.
 *
 *     pnpm check:app-threads
 */
import { createHmac } from "node:crypto";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { NestChatController } from "../apps/api/src/channels/nestchat/nestchat.controller";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import type { RoutingService } from "../apps/api/src/channels/routing.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { TenantContext } from "../apps/api/src/tenancy/tenant-context";
import type { PushService } from "../apps/api/src/push/push.service";
import type { ConversationSubjectService } from "../apps/api/src/ai/conversation-subject.service";
import type { MediaService } from "../apps/api/src/media/media.service";
import { DEFAULT_NESTCHAT_APP } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const nestchat = new NestChatService(store, new VisitorBus());
  const subjects = { customerWrote() {}, fieldsChanged: async () => {} } as unknown as ConversationSubjectService;
  const realtime = { emitConversationAssigned() {}, emitMessageCreated() {}, emitConversationUpdated() {} } as unknown as RealtimeGateway;
  const ingest = new IngestService(
    store,
    { route: async () => ({ assigneeUserId: null, assignedTeamId: null }) } as unknown as RoutingService,
    realtime,
    { bind() {}, orgId: ORG_ID } as unknown as TenantContext,
    { notify() {} } as unknown as PushService,
    subjects,
  );
  const controller = new NestChatController(
    nestchat, store, ingest, new VisitorBus(), undefined as unknown as MediaService, realtime, subjects,
  );

  await store.createCustomField(ORG_ID, {
    key: "order_id", label: "Order ID", type: "text", entity: "conversation", options: [], inboxIds: [],
  });
  const inbox = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Courier app", handle: "courier", teamIds: [], routingStrategy: "manual",
  });
  await nestchat.updateApp(inbox.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, threadFieldKey: "order_id" });
  const secret = await nestchat.rotateIdentitySecret(inbox.id);
  const appKey = await nestchat.ensureAppKey(inbox.id);

  const user = "42";
  const userHash = createHmac("sha256", secret).update(user).digest("hex");
  const open = (fields?: Record<string, string>) =>
    controller.appSession(appKey, { externalId: user, userHash, name: "Courier 42", fields });
  /** Sends and returns the token to use next, as the SDK does, and the
   *  conversation the server says the session is now in. */
  const say = async (token: string, text: string) => {
    const res = await controller.send(`Bearer ${token}`, { body: text, attachments: [] });
    const next = res.token ?? token;
    return { token: next, conversationId: nestchat.verifyVisitorToken(next).conversationId || undefined };
  };
  const orderOf = async (id: string | undefined) =>
    id ? (await store.customFieldValues(ORG_ID, "conversation", [id])).get(id)?.find((v) => v.key === "order_id")?.value : undefined;
  const textsOf = async (id: string | undefined) =>
    id ? ((await store.getConversation(id))?.messages ?? []).map((m) => m.body) : [];

  console.log("\nOrder A, then order B\n");
  const a1 = await open({ order_id: "A-100" });
  const a = await say(a1.token, "Where is order A?");
  ok("order A gets a conversation", !!a.conversationId);
  ok("labelled A", (await orderOf(a.conversationId)) === "A-100");

  const b1 = await open({ order_id: "B-200" });
  ok("opening order B finds nothing yet", !b1.hasConversation && b1.messages.length === 0);
  const b = await say(b1.token, "Regarding order #B");
  ok("order B's message opens its own conversation", !!b.conversationId && b.conversationId !== a.conversationId, `${b.conversationId} vs ${a.conversationId}`);
  ok("labelled B", (await orderOf(b.conversationId)) === "B-200");
  ok("order A is still labelled A", (await orderOf(a.conversationId)) === "A-100");
  ok("and A's chat has only A's message", (await textsOf(a.conversationId)).join("|") === "Where is order A?");

  const b2 = await say(b.token, "It was meant to arrive today");
  ok("B's next message stays in B", b2.conversationId === b.conversationId);

  console.log("\nBack to order A\n");
  const a2 = await open({ order_id: "A-100" });
  ok("opening A shows A's chat", a2.hasConversation && a2.messages.some((m) => m.body === "Where is order A?"));
  const a3 = await say(a2.token, "Any update on A?");
  ok("and writing goes to A", a3.conversationId === a.conversationId);
  ok("not to B, which moved last", !(await textsOf(b.conversationId)).includes("Any update on A?"));

  console.log("\nGeneral support\n");
  const g1 = await open();
  ok("with orders open, general support starts empty", !g1.hasConversation);
  const g = await say(g1.token, "How do I change my bank details?");
  ok("and gets its own conversation", !!g.conversationId && g.conversationId !== a.conversationId && g.conversationId !== b.conversationId);
  ok("with no order on it", (await orderOf(g.conversationId)) === undefined);
  const g2 = await open();
  ok("opening general support again resumes it", g2.hasConversation && g2.messages.some((m) => m.body === "How do I change my bank details?"));
  ok("and the orders are untouched", (await orderOf(a.conversationId)) === "A-100" && (await orderOf(b.conversationId)) === "B-200");

  console.log("\nTwo quick messages before the new token arrives\n");
  const c1 = await open({ order_id: "C-300" });
  const first = await say(c1.token, "Order C is damaged");
  const second = await say(c1.token, "Photo to follow");
  ok("both land in one new conversation for C", !!first.conversationId && second.conversationId === first.conversationId);

  console.log("\nAn order's chat closed while the app was open\n");
  await store.setStatus(b.conversationId!, "closed");
  const reopened = await say(b2.token, "Still not here");
  ok("starts a new conversation", !!reopened.conversationId && reopened.conversationId !== b.conversationId);
  ok("still about order B", (await orderOf(reopened.conversationId)) === "B-200");
  ok("and the closed one is left alone", !(await textsOf(b.conversationId)).includes("Still not here"));

  console.log("\nA channel without a thread key\n");
  const plain = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Support app", handle: "support", teamIds: [], routingStrategy: "manual",
  });
  await nestchat.updateApp(plain.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, identity: "off" });
  const plainKey = await nestchat.ensureAppKey(plain.id);
  const p1 = await controller.appSession(plainKey, { externalId: "7", name: "Seven", fields: { order_id: "X-1" } });
  const p = await say(p1.token, "Hello");
  const p2 = await controller.appSession(plainKey, { externalId: "7", name: "Seven", fields: { order_id: "Y-2" } });
  const q = await say(p2.token, "Another question");
  ok("keeps one ongoing conversation", !!p.conversationId && q.conversationId === p.conversationId);

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void runInTenant(ORG_ID, main);
