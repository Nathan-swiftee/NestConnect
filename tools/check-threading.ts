/**
 * Where does an inbound message land?
 *
 * One rule, and getting it wrong is invisible until a customer is talking to two
 * copies of themselves. It shipped wrong: `findOrCreateOpenConversation` matched
 * only `open` and `pending` in both stores, so a customer replying to a
 * conversation an agent had snoozed opened a *second* thread with them — and the
 * "a new customer message on a closed or snoozed chat wakes it back up" branch,
 * which is written and correct in both stores, could never run, because the
 * conversation it was waiting for was never the one the message arrived on.
 *
 * Nothing catches that. It typechecks, it builds, no request fails, and the
 * duplicate looks exactly like a customer who has started a new conversation.
 * Hence this: the smallest thing that would have.
 *
 * Runs against `MemoryStore`, which implements the same `Store` interface the
 * Prisma one does and carries the same wake branch. That makes it a check of the
 * *rule*, not of a query — the rule now lives in `THREADABLE_STATUSES` and both
 * stores read it from there, which is the other half of the fix: it was written
 * out twice and the two copies were wrong in the same way.
 *
 *     pnpm check:threading
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import type { RoutingService } from "../apps/api/src/channels/routing.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { TenantContext } from "../apps/api/src/tenancy/tenant-context";
import type { PushService } from "../apps/api/src/push/push.service";
import type { ConversationSubjectService } from "../apps/api/src/ai/conversation-subject.service";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const inbox = (await store.listInboxes("org_demo")).find((i) => i.type === "whatsapp");
  if (!inbox) throw new Error("no WhatsApp inbox in the fixtures to test against");

  const contact = await store.upsertContactByIdentity({
    orgId: "org_demo",
    kind: "wa_id",
    value: "447700900999",
    displayName: "Threading Check",
  });
  const arrive = () =>
    store.findOrCreateOpenConversation({
      orgId: "org_demo",
      inboxId: inbox.id,
      contact,
      channel: inbox.type,
    });

  console.log("\nan inbound message threads into the conversation it belongs to\n");

  const first = await arrive();
  ok("a first message opens a conversation", first.created);
  await store.appendInboundMessage(first.conversation.id, {
    authorName: contact.displayName,
    body: "Are you open Sunday?",
    channel: "whatsapp",
  });

  // ── snoozed: the case that was broken ───────────────────────────────────
  await store.snooze(first.conversation.id, new Date(Date.now() + 3_600_000).toISOString());
  ok("an agent can snooze it", (await store.getConversation(first.conversation.id))?.status === "snoozed");

  const reply = await arrive();
  ok("a reply threads into the same conversation", !reply.created, `created=${reply.created}`);
  ok(
    "and onto the same id rather than a duplicate",
    reply.conversation.id === first.conversation.id,
    `${first.conversation.id} vs ${reply.conversation.id}`,
  );

  await store.appendInboundMessage(reply.conversation.id, {
    authorName: contact.displayName,
    body: "Actually — different question",
    channel: "whatsapp",
  });
  const woken = await store.getConversation(first.conversation.id);
  ok("the reply wakes it out of snooze", woken?.status === "open", `status=${woken?.status}`);
  ok("and clears the timer with it", woken?.snoozedUntil == null, `snoozedUntil=${woken?.snoozedUntil}`);
  ok("both messages are in the one thread", woken?.messages?.length === 2, `${woken?.messages?.length} message(s)`);

  // ── closed: the deliberate half, so the fix can't quietly widen ─────────
  // Checked on a fresh contact, because the point is what happens when the only
  // thread with someone is closed — not what happens when a duplicate is lying
  // around open, which is the bug's own symptom rather than this rule.
  const settled = await store.upsertContactByIdentity({
    orgId: "org_demo",
    kind: "wa_id",
    value: "447700900998",
    displayName: "Settled Customer",
  });
  const done = await store.findOrCreateOpenConversation({
    orgId: "org_demo",
    inboxId: inbox.id,
    contact: settled,
    channel: inbox.type,
  });
  await store.setStatus(done.conversation.id, "closed");
  const afterClose = await store.findOrCreateOpenConversation({
    orgId: "org_demo",
    inboxId: inbox.id,
    contact: settled,
    channel: inbox.type,
  });
  ok("a closed thread still starts a new conversation", afterClose.created, `created=${afterClose.created}`);

  console.log("\nA live-chat customer answered on WhatsApp, replying on WhatsApp\n");
  // The bug: the reply opened a brand-new WhatsApp chat, because only this
  // number's own threads were looked at — and the conversation the agent had
  // answered from belongs to the live-chat inbox.
  const ingest = new IngestService(
    store,
    { route: async () => ({ assigneeUserId: null, assignedTeamId: null }) } as unknown as RoutingService,
    { emitConversationAssigned() {}, emitMessageCreated() {}, emitConversationUpdated() {} } as unknown as RealtimeGateway,
    { bind() {}, orgId: ORG_ID } as unknown as TenantContext,
    { notify() {} } as unknown as PushService,
    { customerWrote() {}, fieldsChanged: async () => {} } as unknown as ConversationSubjectService,
  );
  const chat = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Website chat", handle: "site", teamIds: [], routingStrategy: "manual",
  });
  const visitor = await store.upsertContactByIdentity({
    orgId: ORG_ID, kind: "phone", value: "+447700900777", displayName: "Courier Kim",
  });
  const live = await ingest.ingestNestChat({ inbox: chat, contact: visitor, text: "Is my parcel collected?" });
  const agent = (await store.getUser(DEMO_USER_ID))!;
  const answered = await store.addMessage(live!.conversationId, { body: "Yes — I'll message you on WhatsApp", internal: false, channel: "whatsapp" }, agent);
  await store.setMessageInbox(answered!.id, inbox.id);
  const waReply = await ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from: "447700900777", text: "Thanks!" });
  ok("the reply joins the live-chat conversation", waReply?.conversationId === live!.conversationId, `${waReply?.conversationId} vs ${live!.conversationId}`);
  ok("rather than opening a new WhatsApp chat", waReply?.created === false);
  const thread = await store.getConversation(live!.conversationId);
  ok("and arrives there as a WhatsApp message", thread?.messages.at(-1)?.body === "Thanks!" && thread?.messages.at(-1)?.channel === "whatsapp");

  // If this number's own chat with them has moved since, that's where they are.
  const own = await store.findOrCreateOpenConversation({ orgId: ORG_ID, inboxId: inbox.id, contact: visitor, channel: "whatsapp" });
  await store.appendInboundMessage(own.conversation.id, { authorName: "Courier Kim", body: "New question", channel: "whatsapp" });
  const later = await ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from: "447700900777", text: "About that question…" });
  ok("a newer WhatsApp chat of their own wins", later?.conversationId === own.conversation.id, `${later?.conversationId}`);

  // A closed live chat isn't joined: that conversation is over.
  await store.setStatus(own.conversation.id, "closed");
  await store.setStatus(live!.conversationId, "closed");
  const fresh = await ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from: "447700900777", text: "Me again" });
  ok("a closed one starts a new WhatsApp chat", fresh?.created === true && fresh.conversationId !== live!.conversationId);

  console.log(failed ? `\n${failed} failed\n` : "\nall good\n");
  if (failed) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
