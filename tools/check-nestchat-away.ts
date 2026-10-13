/**
 * The website chat when nobody is online, against the in-memory store.
 *
 *   A  someone online: no automatic reply;
 *   B  nobody online and no email for them: one reply asking for it — a real
 *      message in the thread, marked automatic, pushed to their widget —
 *      that leaves the chat unassigned, unread and previewing what they said;
 *   C  not again while nobody has replied, but again after a person has, now
 *      saying we'll email them at the address we have (and using their name);
 *   D  switched off, or a closed chat: nothing;
 *   E  it's never emailed on as an "unseen reply", and the widget is told what
 *      we already know about the visitor so it doesn't ask twice.
 *
 *     pnpm check:nestchat-away
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { NestChatService, visitorStamp } from "../apps/api/src/channels/nestchat/nestchat.service";
import type { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import { unseenReplies } from "../apps/api/src/channels/nestchat/visitor-email.service";
import { DEFAULT_NESTCHAT_AWAY, fillVisitorText, type User } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const pushed: Array<{ conversationId: string; event: { kind: string; payload?: { auto?: string; body?: string } } }> = [];
  const bus = { publish: (conversationId: string, event: never) => pushed.push({ conversationId, event }) } as unknown as VisitorBus;
  const nestchat = new NestChatService(store, bus);

  await runInTenant(ORG_ID, async () => {
    const chat = await store.createInbox({
      orgId: ORG_ID, type: "nestchat", name: "Website chat", handle: "shop.example.com", teamIds: ["team_support"],
      routingStrategy: "manual",
    });
    const team = await store.getMembers("team_support");
    const setEveryone = async (available: boolean) => {
      for (const u of team) await store.updateMyPreferences(u.id, { available, schedule: null });
    };
    const visitor = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "visitor_dana", displayName: "Visitor 4f2a1c" });
    const { conversation } = await store.findOrCreateOpenConversation({
      orgId: ORG_ID, inboxId: chat.id, contact: visitor, channel: "nestchat", startedBy: visitorStamp("visitor_dana"),
    });
    const say = async (body: string) => store.appendInboundMessage(conversation.id, { authorName: "Dana", body, channel: "nestchat" });
    const autos = async () => ((await store.getConversation(conversation.id))?.messages ?? []).filter((m) => m.auto);

    console.log("\nA — someone online\n");
    await setEveryone(true);
    await say("Hi, do you deliver on Saturdays?");
    ok("no automatic reply", !(await nestchat.awayReply(chat, conversation.id)) && (await autos()).length === 0);

    console.log("\nB — nobody online, no email\n");
    await setEveryone(false);
    const before = await store.getConversation(conversation.id);
    const asked = await nestchat.awayReply(chat, conversation.id);
    const after = await store.getConversation(conversation.id);
    const stored = (await autos())[0];
    ok("one reply, asking for their email", asked?.auto === "away_ask" && asked.body === DEFAULT_NESTCHAT_AWAY.askEmail, asked?.body);
    ok("a real message in the thread, marked automatic, from no one", stored?.direction === "out" && stored.auto === "away_ask" && !stored.internal && !stored.authorUserId);
    ok("pushed to their open widget", pushed.some((p) => p.conversationId === conversation.id && p.event.payload?.auto === "away_ask"));
    ok(
      "the chat is still unassigned, unread, and previewing what they said",
      !after?.assigneeUserId && after?.unread === before?.unread && after?.preview === before?.preview,
      JSON.stringify({ assignee: after?.assigneeUserId, unread: after?.unread, preview: after?.preview }),
    );

    console.log("\nC — once per stretch\n");
    await say("Hello?");
    ok("not again while nobody has replied", !(await nestchat.awayReply(chat, conversation.id)) && (await autos()).length === 1);
    const agent = team[0] as User;
    await store.addMessage(conversation.id, { body: "Yes — until 2pm!", internal: false }, agent);
    await store.updateContact(visitor.id, { email: "dana@example.com", displayName: "Dana Reeves" });
    await say("Great, and Sundays?");
    const again = await nestchat.awayReply(chat, conversation.id);
    ok(
      "again after a person replied — now with the email we have, and their name",
      again?.auto === "away" && again.body === "There's nobody online right now — we'll get back to you by email at dana@example.com.",
      again?.body,
    );
    await nestchat.updateAway(chat.id, { ...DEFAULT_NESTCHAT_AWAY, withEmail: "Sorry {name}, we're out — we'll email {email}." });
    await store.addMessage(conversation.id, { body: "One more thing…", internal: false }, agent);
    await say("ok");
    ok("in the business's own words", (await nestchat.awayReply(chat, conversation.id))?.body === "Sorry Dana, we're out — we'll email dana@example.com.");

    console.log("\nD — switched off, or closed\n");
    await store.addMessage(conversation.id, { body: "Back now", internal: false }, agent);
    await nestchat.updateAway(chat.id, { ...DEFAULT_NESTCHAT_AWAY, autoReply: false });
    await say("thanks");
    ok("switched off: nothing", !(await nestchat.awayReply(chat, conversation.id)));
    await nestchat.updateAway(chat.id, DEFAULT_NESTCHAT_AWAY);
    await store.setStatus(conversation.id, "closed");
    ok("a closed chat: nothing", !(await nestchat.awayReply(chat, conversation.id)));

    console.log("\nE — never emailed on; nothing asked twice\n");
    const thread = (await store.getConversation(conversation.id))?.messages ?? [];
    const unseen = unseenReplies(thread, 0, new Date(Date.now() + 60_000));
    ok("the unseen-reply email never includes it", unseen.every((m) => !m.auto) && thread.some((m) => m.auto));
    const known = await nestchat.knownFor(visitor.id);
    ok("the widget is told what we already have", known.email && known.name && !known.phone, JSON.stringify(known));
    const stranger = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "visitor_x", displayName: "Visitor 9a8b7c" });
    const none = await nestchat.knownFor(stranger.id);
    ok("…and a stranger has nothing", !none.email && !none.name && !none.phone);
    ok("a blank {name} takes its space with it", fillVisitorText("Sorry {name}, we're out.", {}) === "Sorry, we're out.");
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall away checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
