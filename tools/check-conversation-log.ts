/**
 * The conversation log: everything that happens to a conversation besides its
 * messages, as people read it.
 *
 * One live chat, start to finish: it arrives and is routed (and the log says
 * why), is assigned, moved, prioritised, labelled, filed under an organisation,
 * has a field filled in, is snoozed and reopened by the customer, claimed by a
 * reply, closed and reopened — and each step reads as a sentence, newest first,
 * with who did it. Then: a message that fails and a snooze that wakes. (One
 * workspace not seeing another's log is proven on Postgres, in
 * check-tenant-isolation.)
 *
 *     pnpm check:conversation-log
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import { ConversationLog, SYSTEM } from "../apps/api/src/conversations/conversation-log";
import { CustomFieldsController } from "../apps/api/src/custom-fields/custom-fields.controller";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { TenantContext } from "../apps/api/src/tenancy/tenant-context";
import type { PushService } from "../apps/api/src/push/push.service";
import type { ConversationSubjectService } from "../apps/api/src/ai/conversation-subject.service";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const NATHAN = DEMO_USER_ID; // admin
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
  const fields = new CustomFieldsController(store);

  await runInTenant(ORG_ID, async () => {
    const latest = async (id: string) => (await convs.events(id))[0];
    const texts = async (id: string) => (await convs.events(id)).map((e) => e.text);

    console.log("\nArriving\n");
    const chat = await store.createInbox({ orgId: ORG_ID, type: "nestchat", name: "Website", handle: "site", teamIds: ["team_support"], routingStrategy: "manual" });
    const marta = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "phone", value: "+447700900501", displayName: "Marta" });
    const acme = await accounts.create(NATHAN, { name: "Acme Ltd", contactIds: [marta.id] });
    await accounts.setRouting(NATHAN, acme.id, { teamId: "team_sales", userId: null });
    const first = await ingest.ingestNestChat({ inbox: chat, contact: marta, text: "Hello?" });
    const id = first!.conversationId;
    const arrival = (await convs.events(id)).reverse();
    ok("first: Marta started it on live chat", arrival[0]?.text === "Marta started the conversation on live chat" && arrival[0]?.actor.kind === "customer", arrival[0]?.text);
    ok("then: routed to Sales", arrival[1]?.text === "Routed to Sales team" && arrival[1]?.actor.kind === "system", arrival[1]?.text);
    ok("and why: via her organisation", arrival[1]?.detail === "Via their organisation, Acme Ltd", arrival[1]?.detail ?? "");

    console.log("\nWorked on\n");
    await convs.assign(id, { assigneeUserId: JAMES }, NATHAN);
    let e = await latest(id);
    ok("Nathan assigns it to James", e?.text === "Nathan A assigned it to James" && e.actor.kind === "agent", e?.text);
    await convs.assign(id, { assigneeUserId: NATHAN }, NATHAN);
    e = await latest(id);
    ok("assigning yourself reads as taking it", e?.text === "Nathan A took the conversation" && e.detail === "Was James", `${e?.text} / ${e?.detail}`);
    await convs.assign(id, { assigneeUserId: null }, NATHAN);
    e = await latest(id);
    ok("unassigning, from whom", e?.text === "Nathan A unassigned it" && e.detail === "Was Nathan A", `${e?.text} / ${e?.detail}`);
    await convs.assign(id, { assigneeUserId: null, assignedTeamId: "team_support" }, JAMES);
    e = await latest(id);
    ok("moved to another team, from where", e?.text === "James moved it to Support team" && e.detail === "From Sales team", `${e?.text} / ${e?.detail}`);
    await convs.setPriority(id, { priority: "urgent" }, NATHAN);
    e = await latest(id);
    ok("priority, with what it was", e?.text === "Nathan A set the priority to Urgent" && e.detail === "Was Normal", `${e?.text} / ${e?.detail}`);
    const labels = await store.listLabels(ORG_ID);
    await convs.setLabels(id, [labels[0]!.id], JAMES);
    ok("a label added, by name", (await latest(id))?.text === `James added the label “${labels[0]!.name}”`, (await latest(id))?.text);
    await convs.setLabels(id, [labels[1]!.id], JAMES);
    e = await latest(id);
    ok("labels swapped", e?.text === "James changed the labels" && e.detail === `Added ${labels[1]!.name} · Removed ${labels[0]!.name}`, `${e?.text} / ${e?.detail}`);
    await convs.setLabels(id, [labels[1]!.id], JAMES);
    ok("the same labels again log nothing", (await latest(id))?.type === "labels" && (await convs.events(id)).filter((x) => x.type === "labels").length === 2);
    // In two organisations, which one a chat is about is a choice someone makes.
    await accounts.create(NATHAN, { name: "Beta plc", contactIds: [marta.id] });
    await accounts.setConversationAccount(NATHAN, id, acme.id);
    ok("filed under an organisation", (await latest(id))?.text === "Nathan A filed it under Acme Ltd", (await latest(id))?.text);
    await store.createCustomField(ORG_ID, { key: "order_id", label: "Order ID", type: "text", entity: "conversation", options: [], inboxIds: [] });
    await fields.setValues("conversation", id, { values: { order_id: "DG-1" } }, JAMES);
    e = await latest(id);
    ok("a field filled in, old → new", e?.text === "James updated Order ID" && e.detail === "Order ID: — → DG-1", `${e?.text} / ${e?.detail}`);
    await fields.setValues("conversation", id, { values: { order_id: "DG-1" } }, JAMES);
    ok("the same value again logs nothing", (await convs.events(id)).filter((x) => x.type === "fields").length === 1);

    console.log("\nSnoozed, reopened, closed\n");
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await convs.snooze(id, until, NATHAN);
    e = await latest(id);
    ok("snoozed, with when for the reader to show", e?.text === "Nathan A snoozed it" && e.until === until, `${e?.text} / ${e?.until}`);
    await ingest.ingestNestChat({ inbox: chat, contact: marta, text: "Any news?", conversationId: id });
    e = await latest(id);
    ok("the customer writing back reopens it", e?.text === "Reopened — Marta wrote back" && e.detail === "Was Snoozed", `${e?.text} / ${e?.detail}`);
    await convs.sendMessage(id, { body: "On it!" } as never, JAMES);
    const afterReply = await convs.events(id);
    const claim = afterReply.find((x) => x.type === "assigned");
    ok("a reply on an unassigned chat claims it", claim?.text === "James took the conversation" && claim.detail?.startsWith("By replying") === true, `${claim?.text} / ${claim?.detail}`);
    await convs.setStatus(id, { status: "closed" }, JAMES);
    ok("closed", (await latest(id))?.text === "James closed the conversation");
    await convs.setStatus(id, { status: "open" }, NATHAN);
    e = await latest(id);
    ok("reopened by a teammate", e?.text === "Nathan A reopened the conversation" && e.detail === "Was Closed", `${e?.text} / ${e?.detail}`);

    console.log("\nThe rest\n");
    const log = new ConversationLog(store);
    await convs.snooze(id, new Date(Date.now() - 1000).toISOString(), NATHAN);
    await log.track(id, SYSTEM, () => store.wakeSnoozed(id));
    ok("a snooze coming due", (await latest(id))?.text === "Back from snooze");
    await log.record(id, "message_failed", SYSTEM, { reason: "Outside the 24-hour window", preview: "Hi Marta" });
    e = await latest(id);
    ok("a message that failed, and why", e?.text === "A message couldn't be sent" && e.detail === "Outside the 24-hour window · “Hi Marta”", `${e?.text} / ${e?.detail}`);
    const all = await convs.events(id);
    ok("newest first", all.every((x, i) => i === 0 || all[i - 1]!.at >= x.at));
    ok("every entry has words", all.every((x) => x.text.length > 0), all.filter((x) => !x.text).map((x) => x.type).join());
    console.log(`\n  (${all.length} entries)\n${(await texts(id)).map((t) => `    · ${t}`).join("\n")}`);
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall conversation log checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
