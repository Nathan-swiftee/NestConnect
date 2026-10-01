/**
 * Can a customer read their own past conversations — and only their own?
 *
 * Two halves, and the second is the reason this is a check rather than a test of
 * one method.
 *
 * The feature: a closed chat is never resumed — `threadFor` only ever joins an
 * open one — so the moment an agent resolved a thread it left the customer's
 * side entirely. They reopened the chat, found an empty box, and everything
 * agreed about their order was readable only by the business. The app had no
 * endpoint that could even ask.
 *
 * The danger: the thing being added is "fetch a conversation by id" on a public,
 * unauthenticated surface, where the id is a string a stranger sends. Everything
 * standing between that and any thread in the database is two comparisons
 * against a signed token. So the refusals are checked as carefully as the
 * reads — another customer's thread, another channel's thread, and an internal
 * note inside one of their own.
 *
 *     pnpm check:visitor-history
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import type { Contact, Inbox, User } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const ORG = "org_demo";

async function main(): Promise<void> {
  const store = new MemoryStore();
  const nestchat = new NestChatService(store, new VisitorBus());

  const teams = await store.listTeams(ORG);
  const agent = (await store.getMembers(teams[0]!.id))[0] as User;
  if (!agent) throw new Error("the fixtures need somebody who can answer");

  // Two channels, because half of what is under test is that one channel's
  // customer cannot read the threads they opened on another.
  const chat = await store.createInbox({
    orgId: ORG,
    type: "nestchat",
    name: "Ding app",
    handle: "ding",
    teamIds: [teams[0]!.id],
    routingStrategy: "round_robin",
  });
  const other = (await store.listInboxes(ORG)).find((i) => i.type !== "nestchat");
  if (!other) throw new Error("the fixtures need a second channel");

  const marta = await store.upsertContactByIdentity({
    orgId: ORG,
    kind: "nestchat",
    value: "visitor_marta",
    displayName: "Marta Nowak",
  });
  const someoneElse = await store.upsertContactByIdentity({
    orgId: ORG,
    kind: "nestchat",
    value: "visitor_other",
    displayName: "Somebody Else",
  });

  /** A conversation with one thing said in it. */
  async function thread(
    contact: Contact,
    inbox: Inbox,
    said: string,
  ): Promise<string> {
    const { conversation } = await store.findOrCreateOpenConversation({
      orgId: ORG,
      inboxId: inbox.id,
      contact,
      channel: inbox.type,
    });
    await store.appendInboundMessage(conversation.id, {
      authorName: contact.displayName,
      body: said,
      channel: inbox.type,
    });
    return conversation.id;
  }

  const claims = {
    visitorId: "visitor_marta",
    inboxId: chat.id,
    contactId: marta.id,
    conversationId: "",
  };

  console.log("\na customer's own history, and nobody else's\n");

  // ── her first chat, resolved and gone from her view ─────────────────────
  const first = await thread(marta, chat, "My order is missing an item");
  await store.addMessage(
    first,
    { body: "Sorted — a replacement is on the way", internal: false },
    agent,
  );
  await store.setStatus(first, "closed");

  let listed = await nestchat.visitorConversations(claims);
  ok("a resolved chat is still hers to read", listed.length === 1, `${listed.length} listed`);
  ok("and says it is closed", listed[0]?.closed === true);
  ok(
    "with the last thing said on it",
    listed[0]?.preview === "Sorted — a replacement is on the way",
    listed[0]?.preview,
  );
  ok("and who said it", listed[0]?.from === "agent", listed[0]?.from);

  // ── a live one, which should sort above it ──────────────────────────────
  const live = await thread(marta, chat, "Different question about Thursday");
  listed = await nestchat.visitorConversations(claims);
  ok("a second chat is listed too", listed.length === 2, `${listed.length} listed`);
  ok("newest first", listed[0]?.id === live, `${listed[0]?.id} vs ${live}`);
  ok("and the live one is not marked closed", listed[0]?.closed === false);

  // ── an internal note must not become the preview ────────────────────────
  await store.addMessage(
    live,
    { body: "@james did we ever refund her for the last one?", internal: true },
    agent,
  );
  listed = await nestchat.visitorConversations(claims);
  ok(
    "an internal note is never the preview",
    listed[0]?.preview === "Different question about Thursday",
    listed[0]?.preview,
  );

  // ── somebody else's chat, and another channel's ─────────────────────────
  const notHers = await thread(someoneElse, chat, "Nothing to do with Marta");
  const elsewhere = await thread(marta, other, "Asked on WhatsApp instead");
  listed = await nestchat.visitorConversations(claims);
  ok(
    "another customer's chat is not in her list",
    !listed.some((c) => c.id === notHers),
    listed.map((c) => c.id).join(", "),
  );
  ok(
    "nor one she had on another channel",
    !listed.some((c) => c.id === elsewhere),
    listed.map((c) => c.id).join(", "),
  );

  console.log("\nand reading one, by an id the client sends\n");

  const hers = await nestchat.visitorConversation(claims, first);
  ok("her own thread opens", (hers?.length ?? 0) === 2, `${hers?.length} messages`);

  const withNote = await nestchat.visitorConversation(claims, live);
  ok(
    "and carries no internal note into it",
    !withNote?.some((m) => m.body.startsWith("@james")),
    withNote?.map((m) => m.body).join(" | "),
  );

  ok(
    "another customer's thread is refused",
    (await nestchat.visitorConversation(claims, notHers)) === undefined,
  );
  ok(
    "another channel's thread is refused",
    (await nestchat.visitorConversation(claims, elsewhere)) === undefined,
  );
  ok(
    "and an id that is nothing at all",
    (await nestchat.visitorConversation(claims, "conv_made_up")) === undefined,
  );

  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
