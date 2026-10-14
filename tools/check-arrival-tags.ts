/**
 * What a channel files its arrivals under: a tag on the customer, a label on
 * the conversation.
 *
 *   A  WhatsApp: a new conversation tags the customer and labels the
 *      conversation, logged as the channel's doing; later messages add nothing.
 *   B  Taken off by hand, it stays off for that conversation.
 *   C  Email and the website chat widget do the same.
 *   D  A NestChat channel set up before the channel-level setting keeps its
 *      in-app SDK tag (the Ding app's).
 *   E  A channel with nothing set files nothing; a label deleted since is
 *      skipped, not a crash.
 *
 *     pnpm check:arrival-tags
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
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

  await runInTenant(ORG_ID, async () => {
    const ding = await store.createLabel({ orgId: ORG_ID, name: "Ding", color: "#1DAA61" });
    const tagsOf = async (id: string) => (await store.getContact(id))!.tags;
    const labelsOf = async (id: string) => ((await store.getConversation(id))!.labels ?? []).map((l) => l.name);

    console.log("\nA — WhatsApp\n");
    const wa = (await store.listInboxes(ORG_ID)).find((i) => i.type === "whatsapp")!;
    const set = await store.updateInbox(wa.id, { contactTag: "Ding", conversationLabelId: ding.id });
    ok("the channel keeps both settings", set?.contactTag === "Ding" && set.conversationLabelId === ding.id);
    const first = await ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from: "447700900801", text: "Hi, is my order out?" });
    const conv = (await store.getConversation(first!.conversationId))!;
    ok("the customer is tagged", (await tagsOf(conv.contact.id)).includes("Ding"), (await tagsOf(conv.contact.id)).join());
    ok("the conversation is labelled", (await labelsOf(conv.id)).join() === "Ding", (await labelsOf(conv.id)).join());
    const logged = (await convs.events(conv.id)).find((e) => e.text.startsWith("Labelled"));
    ok("logged as the channel's doing", logged?.text === "Labelled “Ding”" && logged.detail === "Every conversation on this channel is", `${logged?.text} / ${logged?.detail}`);
    await ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from: "447700900801", text: "Also, the address" });
    ok("a later message adds nothing twice", (await tagsOf(conv.contact.id)).filter((t) => t === "Ding").length === 1 && (await labelsOf(conv.id)).length === 1);

    console.log("\nB — taken off by hand\n");
    await store.updateContact(conv.contact.id, { tags: [] });
    await store.setConversationLabels(conv.id, []);
    await ingest.ingestWhatsApp({ phoneNumberId: "unconfigured", from: "447700900801", text: "Thanks!" });
    ok("stays off while that conversation goes on", (await tagsOf(conv.contact.id)).length === 0 && (await labelsOf(conv.id)).length === 0);

    console.log("\nC — email and the website widget\n");
    const mail = await store.createInbox({ orgId: ORG_ID, type: "email", name: "Ding mail", handle: "ding@example.co.uk", teamIds: ["team_support"], routingStrategy: "manual" });
    await store.updateInbox(mail.id, { contactTag: "Ding email", conversationLabelId: ding.id });
    const em = await ingest.ingestEmail({ toAddress: "ding@example.co.uk", from: "ruth@example.com", fromName: "Ruth", subject: "Delivery", text: "Hello" });
    const emConv = (await store.getConversation(em!.conversationId))!;
    ok("email: tagged and labelled", (await tagsOf(emConv.contact.id)).includes("Ding email") && (await labelsOf(emConv.id)).join() === "Ding");
    const site = await store.createInbox({ orgId: ORG_ID, type: "nestchat", name: "Ding website", handle: "ding-site", teamIds: ["team_support"], routingStrategy: "manual" });
    await store.updateInbox(site.id, { contactTag: "Ding website", conversationLabelId: ding.id });
    const visitor = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "v-123", displayName: "Visitor 123" });
    const nc = await ingest.ingestNestChat({ inbox: (await store.getInbox(site.id))!, contact: visitor, text: "Hi there" });
    ok("website widget: tagged and labelled", (await tagsOf(visitor.id)).includes("Ding website") && (await labelsOf(nc!.conversationId)).join() === "Ding");

    console.log("\nD — the Ding app's tag, set before there was a channel setting\n");
    const app = await store.createInbox({
      orgId: ORG_ID, type: "nestchat", name: "Ding app", handle: "ding-app", teamIds: ["team_support"], routingStrategy: "manual",
      channelConfig: { app: JSON.stringify({ enabled: true, contactTag: "Ding" }) },
    });
    const appUser = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "v-456", displayName: "Visitor 456" });
    await ingest.ingestNestChat({ inbox: (await store.getInbox(app.id))!, contact: appUser, text: "From the app" });
    ok("still tagged Ding", (await tagsOf(appUser.id)).includes("Ding"), (await tagsOf(appUser.id)).join());

    console.log("\nE — nothing set; a label deleted since\n");
    const plain = await store.createInbox({ orgId: ORG_ID, type: "nestchat", name: "Plain", handle: "plain", teamIds: ["team_support"], routingStrategy: "manual" });
    const someone = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "v-789", displayName: "Visitor 789" });
    const pc = await ingest.ingestNestChat({ inbox: (await store.getInbox(plain.id))!, contact: someone, text: "Hello" });
    ok("no tag, no label", (await tagsOf(someone.id)).length === 0 && (await labelsOf(pc!.conversationId)).length === 0);
    await store.updateInbox(plain.id, { conversationLabelId: "lbl_gone" });
    const other = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "v-790", displayName: "Visitor 790" });
    const gone = await ingest.ingestNestChat({ inbox: (await store.getInbox(plain.id))!, contact: other, text: "Hello" });
    ok("a deleted label is skipped, and the chat still arrives", !!gone?.conversationId && (await labelsOf(gone.conversationId)).length === 0);
  });

  console.log(failed ? `\n${failed} failed\n` : "\nall good\n");
  if (failed) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
