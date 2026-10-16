/**
 * Internal notes: hearing that somebody answered yours.
 *
 * A note @-mentioning someone tells them. Their answer rarely @-mentions back,
 * so it used to tell nobody — "@James can you check?" got a reply its writer
 * only found by going back to look. Now a note also tells everyone already in
 * that conversation's notes: whoever wrote one, or was @-mentioned in one.
 *
 *   A  A note's @-mention is told "mentioned you"; nobody else is.
 *   B  The answer, with no @, tells whoever's in the notes — not bystanders.
 *   C  Nobody is told twice about one note, nor about their own.
 *   D  A reply to the customer tells nobody this way.
 *
 *     pnpm check:note-replies
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { PushService } from "../apps/api/src/push/push.service";
import { sendMessageInputSchema } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const NATHAN = DEMO_USER_ID;
const JAMES = "usr_james";
const AMARA = "usr_amara";

async function main(): Promise<void> {
  const store = new MemoryStore();
  const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
  const pushed: Array<{ userIds: string[]; title: string }> = [];
  const push = { notify: (r: { userIds: string[]; title: string }) => pushed.push(r) } as unknown as PushService;
  const notifications = new NotificationsService(store, realtime, push);
  const inert = new Proxy({}, { get: () => async () => {} }) as never;
  const convs = new ConversationsService(store, realtime, inert, { enqueueDelivery: async () => {} } as never, notifications, push, inert);
  // Notifications go out without being awaited by the send; let them land.
  const settle = () => new Promise((r) => setTimeout(r, 50));
  const note = async (by: string, body: string) => {
    await convs.sendMessage("conv_north", sendMessageInputSchema.parse({ body, internal: true }), by);
    await settle();
  };
  const told = async (userId: string) => (await store.listNotifications(userId, 50)).filter((n) => n.conversationId === "conv_north");

  await runInTenant(ORG_ID, async () => {
    console.log("\nA — a note @-mentioning someone\n");
    await note(NATHAN, "@james can you check the VAT on this?");
    const james = await told(JAMES);
    ok("James is told he was mentioned", james.length === 1 && james[0]!.title === "Nathan A mentioned you", JSON.stringify(james.map((n) => n.title)));
    ok("…with the note, by name", /James can you check the VAT/.test(james[0]?.body ?? ""), james[0]?.body);
    ok("Amara, not in it, isn't told", (await told(AMARA)).length === 0);

    console.log("\nB — the answer, with no @\n");
    await note(JAMES, "Checked — it's zero-rated, invoice is wrong. Reissuing.");
    const nathan = await told(NATHAN);
    ok("Nathan, who asked, hears about the answer", nathan.length === 1 && nathan[0]!.title === "James replied in the notes on Northside Logistics", JSON.stringify(nathan.map((n) => n.title)));
    ok("…with what was said", /zero-rated/.test(nathan[0]?.body ?? ""));
    ok("…and it opens that conversation", nathan[0]?.conversationId === "conv_north");
    ok("…on his phone too", pushed.some((p) => p.userIds.includes(NATHAN) && p.title.startsWith("James replied")));
    ok("Amara still isn't told", (await told(AMARA)).length === 0);

    console.log("\nC — never twice, never your own\n");
    await note(NATHAN, "Thanks @james — @amara can you call them?");
    const jamesNow = await told(JAMES);
    ok("James, mentioned and in the notes, is told once, as a mention", jamesNow.length === 2 && jamesNow.filter((n) => n.title === "Nathan A mentioned you").length === 2, JSON.stringify(jamesNow.map((n) => n.title)));
    ok("Amara is told she was mentioned", (await told(AMARA)).length === 1);
    ok("Nathan isn't told about his own note", (await told(NATHAN)).length === 1);
    await note(AMARA, "Called — they're happy.");
    ok("now Amara's in the notes, her answer reaches both", (await told(NATHAN)).length === 2 && (await told(JAMES)).length === 3);

    console.log("\nD — a reply to the customer\n");
    const before = (await told(NATHAN)).length + (await told(JAMES)).length + (await told(AMARA)).length;
    await convs.sendMessage("conv_north", sendMessageInputSchema.parse({ body: "Hi — we're reissuing the invoice now." }), AMARA);
    await settle();
    const after = (await told(NATHAN)).length + (await told(JAMES)).length + (await told(AMARA)).length;
    ok("tells nobody", after === before);
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
