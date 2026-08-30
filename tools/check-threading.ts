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

  console.log(failed ? `\n${failed} failed\n` : "\nall good\n");
  if (failed) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
