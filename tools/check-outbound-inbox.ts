/**
 * Which number, or which address, an outbound message actually goes out from.
 *
 * Sibling to check-template-scope.ts, and the same shape of bug. A conversation
 * has one inbox, but a reply can be sent on a channel the conversation did not
 * start on — the composer's channel switcher — and that reply goes from the
 * *channel's* inbox instead. Which one that is used to be "whichever row of
 * that type the database handed back first", from a query with no ordering.
 *
 * With one number per channel that is stable by accident. With two it is a coin
 * toss that can land differently between two calls, so a customer gets one
 * reply from each of your numbers and nothing explains why. Worse, the inbox
 * was resolved at delivery and then thrown away, so afterwards nobody could say
 * which had been used — including us, reading the database.
 *
 * So two rules, both of which fail silently:
 *
 *   1. The pick is deterministic, and it is the oldest inbox of that type.
 *   2. Whatever was picked is reported back, so it can be recorded against the
 *      message and shown. Including when the send failed — that is exactly when
 *      somebody asks which number it went from.
 *
 *     pnpm check:outbound-inbox
 */
import { readFileSync } from "node:fs";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { ChannelDispatcher } from "../apps/api/src/channels/channel-dispatcher";
import type { ChannelProvider, SendParams, SendResult } from "../apps/api/src/channels/channel-provider";
import type { MediaService } from "../apps/api/src/storage/media.service";
import type { ChannelType, ConversationWithMessages, Message } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Records the inbox it was told to send from, and can be told to fail. */
function recordingProvider(fails = false) {
  const seen: (string | undefined)[] = [];
  const provider: ChannelProvider = {
    supports: () => true,
    sendText: async (p: SendParams): Promise<SendResult> => {
      seen.push(p.inboxId);
      return fails
        ? { ok: false, error: "nope", httpStatus: 400, retryable: false }
        : { ok: true, channelMsgId: "wamid.1", simulated: true };
    },
  } as unknown as ChannelProvider;
  return { provider, seen };
}

const message = (channel?: ChannelType): Message =>
  ({
    id: "msg_1",
    conversationId: "conv_1",
    seq: 2,
    direction: "out",
    authorType: "user",
    body: "On its way.",
    status: "sending",
    internal: false,
    channel,
    messageType: "text",
    attachments: [],
    reactions: [],
    createdAt: new Date().toISOString(),
  }) as Message;

async function main(): Promise<void> {
  const store = new MemoryStore();

  // A second WhatsApp number, added after the first — the setup that turns the
  // old "first of that type" into a coin toss.
  const second = await store.createInbox({
    orgId: ORG_ID,
    type: "whatsapp",
    name: "+44 345",
    handle: "+44 345 900 0100",
  });
  const inboxes = await store.listInboxes();
  const whatsapps = inboxes.filter((i) => i.type === "whatsapp");
  const emails = inboxes.filter((i) => i.type === "email");

  console.log("\nThe order the rule depends on\n");
  ok("there are two of each to choose between", whatsapps.length === 2 && emails.length === 2);
  ok(
    "the newer number is not first",
    whatsapps[0].id !== second.id,
    `${whatsapps.map((i) => i.handle).join(" then ")}`,
  );
  const twice = (await store.listInboxes()).map((i) => i.id).join(",");
  ok("and listing twice gives the same order", twice === inboxes.map((i) => i.id).join(","));

  // An email conversation, so a WhatsApp reply on it is the cross-channel case.
  const emailInbox = emails[1]; // deliberately NOT the first: the thread's own
  const conv = {
    id: "conv_1",
    orgId: ORG_ID,
    inboxId: emailInbox.id,
    channel: "email" as ChannelType,
    contact: {
      id: "ct_1",
      orgId: ORG_ID,
      displayName: "Marta",
      phone: "+44 7700 900123",
      email: "marta@example.com",
      tags: [],
    },
    status: "open",
    assigneeUserId: null,
    assigneeName: null,
    assignedTeamId: null,
    priority: "normal",
    labels: [],
    unread: false,
    unreadCount: 0,
    slaDueAt: null,
    snoozedUntil: null,
    lastActivityAt: new Date().toISOString(),
    seq: 2,
    preview: "",
    messages: [],
  } as unknown as ConversationWithMessages;

  const send = async (channel: ChannelType | undefined, fails = false) => {
    const { provider, seen } = recordingProvider(fails);
    const dispatcher = new ChannelDispatcher([provider], store, {} as MediaService);
    const outcome = await dispatcher.attemptSend(conv, message(channel));
    return { outcome, sentFrom: seen[0] };
  };

  /*
   * The checks above run against the in-memory store, which keeps insertion
   * order for free — so they pin the dispatcher's rule but cannot catch the
   * thing that actually broke it, which was a SQL query with no ORDER BY. The
   * ordering is the store's contract now, and this is the only place it can be
   * asserted without a live database.
   */
  const prismaSource = readFileSync("apps/api/src/data/prisma.store.ts", "utf8");
  const listInboxes = prismaSource.slice(prismaSource.indexOf("async listInboxes"), 500 + prismaSource.indexOf("async listInboxes"));
  const ordering = /orderBy:\s*(\[[^\]]*\]|\{[^}]*\})/.exec(listInboxes)?.[1]?.replace(/\s+/g, " ");
  ok(
    "and the SQL behind it says so out loud",
    /createdAt/.test(ordering ?? ""),
    ordering ?? "no orderBy on listInboxes",
  );

  console.log("\nA reply on the thread's own channel\n");
  let r = await send(undefined);
  ok("goes from the thread's own inbox", r.sentFrom === emailInbox.id, r.sentFrom);
  ok(
    "not the channel's default, which is a different mailbox",
    emailInbox.id !== emails[0].id && r.sentFrom !== emails[0].id,
  );

  console.log("\nA reply switched to another channel\n");
  r = await send("whatsapp");
  const first = r.sentFrom;
  ok("goes from a WhatsApp number", whatsapps.some((i) => i.id === first), first);
  ok("the oldest one", first === whatsapps[0].id, `${first} vs oldest ${whatsapps[0].id}`);

  // The actual bug: two sends, two different numbers, no way to tell why.
  const again = await send("whatsapp");
  ok("and the same one next time", again.sentFrom === first, `${first} then ${again.sentFrom}`);

  console.log("\nWhen somebody has chosen which number the channel uses\n");
  /*
   * Oldest-first is deterministic but arbitrary. A workspace that has grown a
   * second number usually wants to be known by one of them in particular, and
   * until it can say so the rule is picking for it.
   */
  await store.setDefaultInbox(second.id, true);
  const chosen = await send("whatsapp");
  ok("the cross-channel reply follows the choice", chosen.sentFrom === second.id, chosen.sentFrom);
  ok("which is not the oldest", second.id !== whatsapps[0].id);
  ok("and it is recorded as such", chosen.outcome.ok && chosen.outcome.inboxId === second.id);

  // A thread already running on a number must not start answering from another.
  const onOwn = { ...conv, inboxId: whatsapps[0].id, channel: "whatsapp" as ChannelType };
  const { provider: p2, seen: seen2 } = recordingProvider();
  await new ChannelDispatcher([p2], store, {} as MediaService).attemptSend(onOwn, message(undefined));
  ok("but a thread on its own number keeps it", seen2[0] === whatsapps[0].id, seen2[0]);

  // Exactly one, and only within its own channel.
  await store.setDefaultInbox(whatsapps[0].id, true);
  const nowDefault = (await store.listInboxes()).filter((i) => i.type === "whatsapp" && i.isDefault);
  ok("choosing another replaces it rather than adding one", nowDefault.length === 1, `${nowDefault.length}`);
  ok("and it is the one just chosen", nowDefault[0]?.id === whatsapps[0].id);
  const mailUntouched = (await store.listInboxes()).filter((i) => i.type === "email" && i.isDefault);
  ok("email's own default is not disturbed", mailUntouched.length === 0);

  await store.setDefaultInbox(whatsapps[0].id, false);
  const cleared = await send("whatsapp");
  ok("clearing hands it back to the oldest", cleared.sentFrom === whatsapps[0].id, cleared.sentFrom);

  console.log("\nWhat comes back, so it can be recorded\n");
  ok("a successful send reports the inbox it used", r.outcome.ok && r.outcome.inboxId === first);
  const bad = await send("whatsapp", true);
  ok(
    "and so does a failed one",
    !bad.outcome.ok && bad.outcome.inboxId === first,
    bad.outcome.ok ? "(it succeeded?)" : String(bad.outcome.inboxId),
  );

  console.log("\nAnd it survives being written down\n");
  // A real stored conversation, because the point here is the round trip.
  const existing = (await store.getConversation("conv_north"))!;
  const stored = await store.addMessage(
    existing.id,
    { body: "On its way.", internal: false },
    { id: "usr_1", name: "Nathan A" } as never,
  );
  ok("a fresh message starts with no inbox", stored?.inboxId === undefined, String(stored?.inboxId));
  await store.setMessageInbox(stored!.id, first!);
  const after = (await store.getConversation(existing.id))?.messages.find((m) => m.id === stored!.id);
  ok("and carries it once stamped", after?.inboxId === first, String(after?.inboxId));
  // Legacy rows keep meaning "the conversation's own inbox", which is right for
  // every message that never crossed channels — so nothing needs backfilling.
  const untouched = (await store.getConversation(existing.id))?.messages.find((m) => m.id !== stored!.id);
  ok("older messages are left alone", untouched?.inboxId === undefined, String(untouched?.inboxId));

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
