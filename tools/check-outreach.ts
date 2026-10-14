/**
 * An agent starts a conversation; the customer's answer comes back to them.
 *
 *   A  Compose opens a new thread: it's the agent's, and an answer lands in it.
 *   B  Compose reuses the customer's open thread from the queue: the agent takes
 *      it (someone else's stays theirs).
 *   C  The agent's thread was resolved before the customer answered: the answer
 *      goes back to that agent, not into the queue — while they're available,
 *      within OUTREACH_WINDOW_DAYS, and only if the customer hadn't written in
 *      that thread (then it's an ordinary new conversation, routed as usual).
 *
 * Runs against MemoryStore; WhatsApp inbound is simulated.
 *
 *     pnpm check:outreach
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { OUTREACH_WINDOW_DAYS, RoutingService } from "../apps/api/src/channels/routing.service";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import { ContactsController } from "../apps/api/src/contacts/contacts.controller";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { TenantContext } from "../apps/api/src/tenancy/tenant-context";
import type { PushService } from "../apps/api/src/push/push.service";
import type { ConversationSubjectService } from "../apps/api/src/ai/conversation-subject.service";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const NATHAN = DEMO_USER_ID;
const JAMES = "usr_james";

async function main(): Promise<void> {
  const store = new MemoryStore();
  const accounts = new AccountsService(new MemoryAccountStore(), store);
  const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
  const ingest = new IngestService(
    store,
    new RoutingService(store, accounts),
    realtime,
    { bind() {}, orgId: ORG_ID } as unknown as TenantContext,
    { notify() {} } as unknown as PushService,
    { customerWrote() {}, fieldsChanged: async () => {} } as unknown as ConversationSubjectService,
  );
  const inert = new Proxy({}, { get: () => async () => {} }) as never;
  const convs = new ConversationsService(store, realtime, inert, { enqueueDelivery: async () => {} } as never, inert, { notify() {} } as never, inert);
  const contacts = new ContactsController(store, realtime, accounts);

  await runInTenant(ORG_ID, async () => {
    const wa = (await store.listInboxes(ORG_ID)).find((i) => i.type === "whatsapp")!;
    // The queue: a team, nobody auto-assigned — so anything not routed to a
    // person shows up unassigned.
    await store.updateInbox(wa.id, { routingStrategy: "manual", teamIds: ["team_support"] });
    const james = (await store.getUser(JAMES))!;
    let n = 0;
    const customer = async (name: string) => {
      const phone = `+4477009006${String(++n).padStart(2, "0")}`;
      return { contact: (await store.createContact({ orgId: ORG_ID, displayName: name, phone })).contact, from: phone.slice(1) };
    };
    const reach = (userId: string, contactId: string) => contacts.reach(userId, contactId, { channel: "whatsapp", inboxId: wa.id });
    const say = (id: string) => store.addMessage(id, { body: "Hi — following up on your order", internal: false }, james);
    const reply = (from: string, text = "Thanks, got it") => ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from, text });
    const conv = async (id: string) => (await store.getConversation(id))!;

    console.log("\nA — a new conversation from Compose\n");
    const ada = await customer("Ada");
    const a = await reach(JAMES, ada.contact.id);
    ok("it's created, and it's James's", a.created && (await conv(a.conversationId)).assigneeUserId === JAMES);
    await say(a.conversationId);
    const aReply = await reply(ada.from);
    ok("her answer lands in it", aReply?.conversationId === a.conversationId && !aReply.created);
    ok("still James's", (await conv(a.conversationId)).assigneeUserId === JAMES);

    console.log("\nB — Compose for a customer whose thread is waiting in the queue\n");
    const ben = await customer("Ben");
    const queued = await reply(ben.from, "Hello?");
    ok("his message opened a thread in the queue", !!queued?.created && (await conv(queued!.conversationId)).assigneeUserId === null);
    const b = await reach(JAMES, ben.contact.id);
    ok("Compose opens that thread", b.conversationId === queued!.conversationId && !b.created);
    ok("and James takes it", (await conv(b.conversationId)).assigneeUserId === JAMES);
    ok("in the same team", (await conv(b.conversationId)).assignedTeamId === "team_support");
    const events = (await convs.events(b.conversationId)).map((e) => e.text);
    ok("logged as James taking it", events.includes("James took the conversation"), events.join(" | "));
    const cara = await customer("Cara");
    const c0 = await reply(cara.from, "Hi");
    await store.assign(c0!.conversationId, { assigneeUserId: NATHAN }, NATHAN);
    await reach(JAMES, cara.contact.id);
    ok("someone else's thread stays theirs", (await conv(c0!.conversationId)).assigneeUserId === NATHAN);

    console.log("\nC — the agent's thread was resolved before the customer answered\n");
    const dan = await customer("Dan");
    const d = await reach(JAMES, dan.contact.id);
    await say(d.conversationId);
    await store.setStatus(d.conversationId, "closed");
    const dReply = await reply(dan.from);
    ok("the answer starts a new thread", !!dReply?.created && dReply.conversationId !== d.conversationId);
    const dNew = await conv(dReply!.conversationId);
    ok("which goes to James, not the queue", dNew.assigneeUserId === JAMES, String(dNew.assigneeUserId));
    ok("in his team", dNew.assignedTeamId === "team_support");
    const routed = (await convs.events(dNew.id)).find((e) => e.text.startsWith("Routed"));
    ok("and the log says why", routed?.detail === "Answering James's message", `${routed?.text} / ${routed?.detail}`);

    const eve = await customer("Eve");
    const e = await reach(JAMES, eve.contact.id);
    await say(e.conversationId);
    await store.setStatus(e.conversationId, "closed");
    await store.updateMyPreferences(JAMES, { available: false });
    const eReply = await reply(eve.from);
    ok("James switched off: the queue has it", (await conv(eReply!.conversationId)).assigneeUserId === null);
    await store.updateMyPreferences(JAMES, { available: true });

    const fay = await customer("Fay");
    const f = await reach(JAMES, fay.contact.id);
    await say(f.conversationId);
    await store.setStatus(f.conversationId, "closed");
    const old = new Date(Date.now() - (OUTREACH_WINDOW_DAYS + 1) * 86_400_000).toISOString();
    for (const c of (store as unknown as { conversations: { id: string; lastActivityAt: string }[] }).conversations) {
      if (c.id === f.conversationId) c.lastActivityAt = old;
    }
    const fReply = await reply(fay.from);
    ok(`over ${OUTREACH_WINDOW_DAYS} days later: the queue has it`, (await conv(fReply!.conversationId)).assigneeUserId === null);

    const gus = await customer("Gus");
    const g = await reach(JAMES, gus.contact.id);
    await say(g.conversationId);
    await reply(gus.from, "Thanks!");
    await store.setStatus(g.conversationId, "closed");
    const gReply = await reply(gus.from, "Something new");
    ok("they'd already answered in it: a new question is routed as usual", (await conv(gReply!.conversationId)).assigneeUserId === null);
  });

  console.log(failed ? `\n${failed} failed\n` : "\nall good\n");
  if (failed) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
