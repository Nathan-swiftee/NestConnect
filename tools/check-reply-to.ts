/**
 * Reply-To on inbound email: who the customer is, and where replies go.
 *
 *   A  A website form (From noreply@, Reply-To the visitor) files under the
 *      visitor, says where it came "via", and each visitor gets their own thread.
 *   B  No Reply-To, a Reply-To that is the sender, or one pointing back at us:
 *      the sender, as before.
 *   C  Names: the Reply-To's own, else the sender's (unless it's a robot's).
 *   D  Postmark and Gmail both read the header; a Gmail import does too.
 *
 *     pnpm check:reply-to
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { EmailService } from "../apps/api/src/channels/email/email.service";
import { correspondent, firstParty, isAutomatedSender } from "../apps/api/src/channels/email/reply-to";
import { planThread } from "../apps/api/src/channels/google/gmail-cutover.service";
import type { GmailMessage } from "../apps/api/src/channels/google/gmail-api";
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
  console.log("\nC — the rules\n");
  ok("a form's robot sender is recognised", isAutomatedSender("noreply@site.co.uk") && isAutomatedSender("no-reply+forms@site.com") && isAutomatedSender("wordpress@site.com"));
  ok("a person isn't", !isAutomatedSender("jane@company.com") && !isAutomatedSender("info@company.com"));
  ok("Reply-To with a name: theirs", correspondent({ email: "noreply@site.com", name: "Website" }, { email: "jane@x.com", name: "Jane Doe" }, []).name === "Jane Doe");
  ok("without one, a robot's name isn't borrowed", correspondent({ email: "noreply@site.com", name: "Website" }, { email: "jane@x.com" }, []).name === "jane@x.com");
  ok("but a person's is", correspondent({ email: "jane@company.com", name: "Jane Smith" }, { email: "jsmith@company.com" }, []).name === "Jane Smith");
  ok("Reply-To = the sender: no via", correspondent({ email: "a@x.com" }, { email: "A@x.com" }, []).via === undefined);
  ok("Reply-To pointing at us: ignored", correspondent({ email: "a@x.com" }, { email: "support@swiftee.co.uk" }, ["support@swiftee.co.uk"]).email === "a@x.com");
  ok("nonsense in Reply-To: ignored", correspondent({ email: "a@x.com" }, { email: "undisclosed-recipients:;" }, []).email === "a@x.com");
  const list = firstParty('"Doe, Jane" <Jane@X.com>, other@y.com');
  ok("a list: the first, with its name", list?.email === "jane@x.com" && list.name === "Doe, Jane", JSON.stringify(list));
  ok("an empty header: none", firstParty("") === undefined && firstParty(undefined) === undefined);

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
  const postmark = new EmailService(ingest);

  await runInTenant(ORG_ID, async () => {
    const inbox = (await store.listInboxes(ORG_ID)).find((i) => i.type === "email")!;
    const to = inbox.handle;

    console.log("\nA — a website form\n");
    const one = await ingest.ingestEmail({
      toAddress: to,
      from: "noreply@site.co.uk",
      fromName: "Website",
      replyTo: { email: "jane@example.com", name: "Jane Doe" },
      subject: "Contact form: delivery question",
      text: "When do you deliver to Leeds?",
      messageId: "<form-1@site.co.uk>",
    });
    const conv = (await store.getConversation(one!.conversationId))!;
    ok("filed under the visitor", conv.contact.email === "jane@example.com" && conv.contact.displayName === "Jane Doe", `${conv.contact.email} ${conv.contact.displayName}`);
    const msg = conv.messages.at(-1)!;
    ok("saying where it came via", msg.email?.via === "noreply@site.co.uk", JSON.stringify(msg.email));
    ok("and authored by them", msg.authorName === "Jane Doe");
    ok("so a reply goes to them (the conversation's address)", conv.contact.email === "jane@example.com");
    const two = await ingest.ingestEmail({
      toAddress: to,
      from: "noreply@site.co.uk",
      fromName: "Website",
      replyTo: { email: "bob@example.com" },
      subject: "Contact form: invoice",
      text: "Can I get a copy of my invoice?",
      messageId: "<form-2@site.co.uk>",
    });
    ok("another visitor gets their own thread", two!.conversationId !== one!.conversationId);
    const bob = (await store.getConversation(two!.conversationId))!;
    ok("named by their address, not 'Website'", bob.contact.displayName === "bob@example.com", bob.contact.displayName);
    const again = await ingest.ingestEmail({ toAddress: to, from: "jane@example.com", fromName: "Jane Doe", text: "Any news?", messageId: "<jane-2@example.com>", references: ["<form-1@site.co.uk>"] });
    ok("when they write back themselves, it's the same thread", again!.conversationId === one!.conversationId);
    ok("with no via", !(await store.getConversation(one!.conversationId))!.messages.at(-1)!.email?.via);

    console.log("\nB — when Reply-To changes nothing\n");
    const plain = await ingest.ingestEmail({ toAddress: to, from: "sam@shop.com", fromName: "Sam", text: "Hello", messageId: "<p1@shop.com>" });
    ok("no Reply-To: the sender", (await store.getConversation(plain!.conversationId))!.contact.email === "sam@shop.com");
    const self = await ingest.ingestEmail({ toAddress: to, from: "kim@shop.com", fromName: "Kim", replyTo: { email: "KIM@shop.com" }, text: "Hi", messageId: "<p2@shop.com>" });
    const selfConv = (await store.getConversation(self!.conversationId))!;
    ok("Reply-To is the sender: the sender, no via", selfConv.contact.email === "kim@shop.com" && !selfConv.messages.at(-1)!.email?.via);
    const loop = await ingest.ingestEmail({ toAddress: to, from: "lee@shop.com", replyTo: { email: to }, text: "Hi", messageId: "<p3@shop.com>" });
    ok("Reply-To pointing at us: the sender", (await store.getConversation(loop!.conversationId))!.contact.email === "lee@shop.com");

    console.log("\nD — Postmark, and a Gmail import\n");
    await postmark.handleWebhook({
      From: "Forms <forms@site.co.uk>",
      FromFull: { Email: "forms@site.co.uk", Name: "Forms" },
      ToFull: [{ Email: to }],
      ReplyTo: '"Ana Ruiz" <ana@example.com>',
      Subject: "Quote request",
      TextBody: "Quote for 20 boxes please",
      MessageID: "pm-1",
    });
    const ana = (await store.listContacts()).find((c) => c.email === "ana@example.com");
    ok("Postmark's ReplyTo is read", ana?.displayName === "Ana Ruiz", ana?.displayName);
    await postmark.handleWebhook({
      FromFull: { Email: "notifications@booking.com", Name: "Bookings" },
      ToFull: [{ Email: to }],
      Headers: [{ Name: "Reply-To", Value: "guest@example.com" }],
      Subject: "New booking",
      TextBody: "A booking came in",
      MessageID: "pm-2",
    });
    ok("as is a raw Reply-To header", !!(await store.listContacts()).find((c) => c.email === "guest@example.com"));

    const header = (name: string, value: string) => ({ name, value });
    const mail = (id: string, headers: Array<{ name: string; value: string }>, labels: string[]): GmailMessage =>
      ({ id, threadId: "t1", labelIds: labels, payload: { headers } }) as unknown as GmailMessage;
    const plan = planThread(
      [
        mail("1", [header("From", "Website <noreply@site.co.uk>"), header("Reply-To", "Tom Hart <tom@example.com>")], ["INBOX"]),
        mail("2", [header("From", `Support <${to}>`)], ["SENT"]),
      ],
      to,
    );
    ok("a Gmail import picks the Reply-To as the customer", plan?.customer.email === "tom@example.com" && plan.customer.name === "Tom Hart", JSON.stringify(plan?.customer));
    ok("and writes their name on what they sent", plan?.messages[0]!.authorName === "Tom Hart");
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
