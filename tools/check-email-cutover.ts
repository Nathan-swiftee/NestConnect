/**
 * Moving from Gmail: delete the email conversations, import what's unread.
 *
 * Pins, against the in-memory store and a fake Gmail:
 *   - which way each message in a thread went, and who the customer is;
 *   - only email conversations are deleted — WhatsApp and website chats stay;
 *   - an unread thread arrives as one open conversation, every message at the
 *     time it was really sent, the customer's last words counted as unread;
 *   - a thread already in Nest isn't imported twice;
 *   - the search only asks for unread, in-the-inbox, recent mail.
 *
 *     pnpm check:email-cutover
 */
import type { GmailMessage } from "../apps/api/src/channels/google/gmail-api";
import { gmail } from "../apps/api/src/channels/google/gmail-api";
import { GmailCutoverService, cutoverQuery, planThread } from "../apps/api/src/channels/google/gmail-cutover.service";
import type { GoogleOAuthService } from "../apps/api/src/channels/google/google-oauth.service";
import type { GmailSyncService } from "../apps/api/src/channels/google/gmail-sync.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import type { EmailCutoverJob } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const MAILBOX = "bookings@swiftee.example";

function mail(id: string, threadId: string, from: string, at: string, body: string, extra: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id,
    threadId,
    internalDate: String(new Date(at).getTime()),
    labelIds: ["INBOX"],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: "Delivery for Friday" },
        { name: "Message-ID", value: `<${id}@mail.example>` },
      ],
      body: { data: Buffer.from(body).toString("base64url") },
    },
    ...extra,
  };
}

/** Every conversation the store holds, whatever view would show it. */
function everything(store: MemoryStore): Array<{ id: string; channel: string; status: string; contact: { displayName: string } }> {
  return (store as unknown as { conversations: Array<{ id: string; channel: string; status: string; contact: { displayName: string } }> }).conversations;
}

async function main() {
  console.log("\nReading a thread\n");
  const t1 = [
    mail("m1", "t1", "Bob Baker <bob@bakery.example>", "2026-09-01T09:00:00Z", "Can you collect Friday?"),
    mail("m2", "t1", `Swiftee <${MAILBOX}>`, "2026-09-01T10:00:00Z", "Yes, 10am.", { labelIds: ["SENT"] }),
    mail("m3", "t1", "Bob Baker <bob@bakery.example>", "2026-09-02T08:00:00Z", "Make it 11?", { labelIds: ["INBOX", "UNREAD"] }),
  ];
  const plan = planThread(t1, MAILBOX);
  ok("the customer is whoever wrote to us", plan?.customer.email === "bob@bakery.example" && plan.customer.name === "Bob Baker");
  ok("ours went out, theirs came in", plan?.messages.map((m) => m.direction).join(",") === "in,out,in");
  ok("a thread with nobody outside the mailbox is nothing to answer",
    planThread([mail("x", "tx", MAILBOX, "2026-09-01T09:00:00Z", "note to self")], MAILBOX) === null);
  const q = cutoverQuery();
  ok("asks Gmail for unread, in the inbox, last 90 days", q.includes("is:unread") && q.includes("in:inbox") && q.includes("newer_than:90d"), q);
  ok("and leaves Gmail's newsletter piles out", q.includes("-category:promotions") && q.includes("-category:social"));

  console.log("\nThe run\n");
  const store = new MemoryStore();
  await runInTenant(ORG_ID, async () => {
    const inbox = await store.createInbox({
      orgId: ORG_ID,
      type: "email",
      name: "Bookings",
      handle: MAILBOX,
      teamIds: ["team_support"],
      routingStrategy: "round_robin",
      channelConfig: { provider: "gmail", email: MAILBOX },
    });
    const emailBefore = await store.countEmailConversations();
    const chatsBefore = everything(store).filter((c) => c.channel !== "email").length;
    ok("the fixture has email and chat conversations to start", emailBefore > 0 && chatsBefore > 0, `${emailBefore} email, ${chatsBefore} other`);

    const t2 = [mail("n1", "t2", "Ann <ann@shop.example>", "2026-09-05T12:00:00Z", "Where is my parcel?", { labelIds: ["INBOX", "UNREAD"] })];
    const threads: Record<string, GmailMessage[]> = { t1, t2 };
    const listed: string[] = [];
    // The fake Gmail: two unread threads.
    (gmail as { listMessages: unknown }).listMessages = async (_t: string, query: string) => {
      listed.push(query);
      return { messages: [{ id: "m3", threadId: "t1" }, { id: "n1", threadId: "t2" }] };
    };
    (gmail as { getThread: unknown }).getThread = async (_t: string, id: string) => ({ id, messages: threads[id] });
    const google = { accessTokenForInbox: async () => "token" } as unknown as GoogleOAuthService;
    const sync = { fetchAttachments: async () => [] } as unknown as GmailSyncService;
    const cutover = new GmailCutoverService(store, google, sync, new RoutingService(store));

    const preview = await cutover.preview();
    ok("the preview counts what would go and what would come",
      preview.emailConversations === emailBefore && preview.mailboxes.find((m) => m.inboxId === inbox.id)?.unreadThreads === 2);
    ok("and changes nothing", (await store.countEmailConversations()) === emailBefore);

    const job: EmailCutoverJob = { status: "running", deleted: 0, total: 0, imported: 0, skipped: 0, failed: 0 };
    await cutover.run(ORG_ID, job);
    ok("every email conversation that was there is gone", job.deleted === emailBefore, `${job.deleted}`);
    const chatsAfter = everything(store).filter((c) => c.channel !== "email").length;
    ok("WhatsApp and website chats are untouched", chatsAfter === chatsBefore);
    ok("both unread threads came in", job.imported === 2 && job.total === 2 && job.failed === 0, JSON.stringify(job));
    ok("the run finishes", job.status === "done");

    const all = everything(store).filter((c) => c.channel === "email");
    ok("as two open email conversations", all.length === 2 && all.every((c) => c.status === "open"));
    const bobConv = all.find((c) => c.contact.displayName === "Bob Baker");
    const bob = bobConv ? await store.getConversation(bobConv.id) : undefined;
    ok("Bob's thread holds its whole history", bob?.messages.length === 3);
    ok("each message at the time it was sent", bob?.messages[0]?.createdAt === "2026-09-01T09:00:00.000Z" &&
      bob?.messages[2]?.createdAt === "2026-09-02T08:00:00.000Z");
    ok("our Gmail reply is ours", bob?.messages[1]?.direction === "out" && bob?.messages[1]?.authorName === "Swiftee");
    ok("only what he wrote since our reply counts as unread", bob?.unreadCount === 1, String(bob?.unreadCount));
    ok("the conversation sits where its last message was", bob?.lastActivityAt === "2026-09-02T08:00:00.000Z");
    ok("it remembers the Gmail thread, so replies go back into it", bob?.channelRef === "t1");
    ok("routing still shares the work out", !!(bob?.assigneeUserId || bob?.assignedTeamId));
    ok("the subject is the thread's", bob?.subject === "Delivery for Friday");

    const again: EmailCutoverJob = { status: "running", deleted: 0, total: 0, imported: 0, skipped: 0, failed: 0 };
    // A second run deletes what the first imported and brings it in again —
    // but a thread that something else brought in meanwhile is left alone.
    const job2 = again;
    (gmail as { listMessages: unknown }).listMessages = async () => ({ messages: [{ id: "n1", threadId: "t2" }] });
    const deleteFirst = store.deleteEmailConversations.bind(store);
    (store as { deleteEmailConversations: unknown }).deleteEmailConversations = async () => 0; // keep what's there
    await cutover.run(ORG_ID, job2);
    (store as { deleteEmailConversations: unknown }).deleteEmailConversations = deleteFirst;
    ok("a thread already in Nest isn't imported twice", job2.imported === 0 && job2.skipped === 1, JSON.stringify(job2));
    ok("listed with the cutover search", listed.every((x) => x === q));
  });

  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
