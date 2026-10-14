/**
 * Forwarding an email takes its attachments with it.
 *
 *   A  The forward carries copies of the original's files; the original keeps its own.
 *   B  An older email (beyond the loaded page) forwards just the same.
 *   C  A note, or a message from another conversation, can't be forwarded this way.
 *
 *     pnpm check:email-forward
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { sendMessageInputSchema } from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function refused(run: () => Promise<unknown>, status: number): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (err) {
    return (err as { getStatus?: () => number }).getStatus?.() === status;
  }
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
  const inert = new Proxy({}, { get: () => async () => {} }) as never;
  const queued: unknown[] = [];
  const convs = new ConversationsService(store, realtime, inert, { enqueueDelivery: async (j: unknown) => void queued.push(j) } as never, inert, { notify() {} } as never, inert);
  const send = (id: string, input: Record<string, unknown>) => convs.sendMessage(id, sendMessageInputSchema.parse(input), "usr_nathan");

  await runInTenant(ORG_ID, async () => {
    const inbox = (await store.listInboxes(ORG_ID)).find((i) => i.type === "email")!;
    const contact = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "email", value: "ruth@example.com", displayName: "Ruth" });
    const { conversation } = await store.findOrCreateOpenConversation({ orgId: ORG_ID, inboxId: inbox.id, contact, channel: "email", subject: "Invoice" });
    const original = (await store.appendInboundMessage(conversation.id, {
      authorName: "Ruth",
      body: "Invoice attached",
      channel: "email",
      attachments: [
        { storageKey: "k-invoice", kind: "document", mime: "application/pdf", size: 2048, filename: "invoice-4471.pdf" },
        { storageKey: "k-photo", kind: "image", mime: "image/jpeg", size: 4096, filename: "pallet.jpg", width: 800, height: 600 },
      ],
    }))!;

    console.log("\nA — the files go along\n");
    const fwd = await send(conversation.id, { body: "FYI", bodyHtml: "<p>FYI</p>", forwardTo: ["accounts@ours.co.uk"], forwardOfId: original.id });
    const names = fwd.attachments.map((a) => a.filename).sort().join();
    ok("the forward carries both files", names === "invoice-4471.pdf,pallet.jpg", names);
    ok("as copies, not the originals", fwd.attachments.every((a) => !original.attachments.some((o) => o.id === a.id)));
    const after = (await store.getConversation(conversation.id))!.messages.find((m) => m.id === original.id)!;
    ok("and the original keeps its own", after.attachments.length === 2);
    ok("it's queued to send", queued.length === 1);
    const bare = await send(conversation.id, { body: "", bodyHtml: "<p>see below</p>", forwardTo: ["a@ours.co.uk"] });
    ok("without forwardOfId, nothing is attached (as before)", bare.attachments.length === 0);

    console.log("\nB — an older email\n");
    for (let i = 0; i < 60; i++) await store.appendInboundMessage(conversation.id, { authorName: "Ruth", body: `Follow-up ${i}`, channel: "email" });
    ok("the original is now beyond the loaded page", !(await store.getConversation(conversation.id))!.messages.some((m) => m.id === original.id));
    const late = await send(conversation.id, { body: "", bodyHtml: "<p>old one</p>", forwardTo: ["b@ours.co.uk"], forwardOfId: original.id });
    ok("it still forwards with its files", late.attachments.length === 2);

    console.log("\nC — what can't be forwarded\n");
    const note = await send(conversation.id, { body: "internal only", internal: true });
    ok("a note", await refused(() => send(conversation.id, { body: "x", forwardTo: ["c@ours.co.uk"], forwardOfId: note.id }), 400));
    const other = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "email", value: "sam@example.com", displayName: "Sam" });
    const { conversation: otherConv } = await store.findOrCreateOpenConversation({ orgId: ORG_ID, inboxId: inbox.id, contact: other, channel: "email" });
    const elsewhere = (await store.appendInboundMessage(otherConv.id, { authorName: "Sam", body: "mine", channel: "email" }))!;
    ok("another conversation's message", await refused(() => send(conversation.id, { body: "x", forwardTo: ["c@ours.co.uk"], forwardOfId: elsewhere.id }), 404));
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
