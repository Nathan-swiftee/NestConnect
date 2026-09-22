/**
 * What the server actually pushes down a visitor's live stream.
 *
 * This exists because of the bug it would have caught on day one. The Dart SDK
 * read `type` and `message`; the server has always sent `kind` and `payload`.
 * Every agent reply was therefore parsed out of a key that was never there and
 * dropped before it reached the UI — for the whole life of the package, in
 * production, on a channel a business was being told to put in front of its
 * customers.
 *
 * What makes it worth a check rather than a one-line fix is *why* nothing
 * noticed. The SDK had a test that stood up a real HTTP server and played an
 * agent replying, and it passed. It passed because the fake server's events had
 * been written from the client's expectation rather than from the server's
 * contract — so the two halves agreed with each other, and neither agreed with
 * the thing they were both pretending to be. A mock written from the code it
 * tests proves only that somebody typed the same thing twice.
 *
 * So the fixture in sdk/contract/visitor-events.json is owned by neither side.
 * Here, the *real* provider and service are driven and what they publish is
 * compared against it. In the Dart SDK, the fake server replays it instead of
 * literals. Rename a key in either place and a build breaks.
 *
 * Shape, not values: which keys exist and what kind of thing each holds. The
 * body of a message is whatever the agent typed, and pinning that would be a
 * test of the fixture rather than of the wire.
 *
 *     pnpm check:visitor-events
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Conversation, Message } from "../packages/schemas/src/index";
import { NESTCHAT_QUOTE_PREVIEW_MAX } from "../packages/schemas/src/index";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { NestChatProvider } from "../apps/api/src/channels/nestchat/nestchat.provider";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { CustomerPushService } from "../apps/api/src/channels/nestchat/customer-push.service";
import { VisitorBus, type VisitorEvent } from "../apps/api/src/channels/nestchat/visitor-bus";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const FIXTURE = join(__dirname, "..", "sdk", "contract", "visitor-events.json");

/** A value's shape, deep, with keys sorted so two orderings compare equal. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    // `undefined` is not on the wire: JSON.stringify drops those keys, so a
    // field the server leaves unset is a field the client never sees, and
    // demanding it in the fixture would be demanding something untrue.
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = shapeOf(v);
    }
    return out;
  }
  return typeof value;
}

const show = (v: unknown) => JSON.stringify(v);

/** A bus that records rather than publishes. */
class RecordingBus extends VisitorBus {
  readonly events: VisitorEvent[] = [];
  override publish(_conversationId: string, event: VisitorEvent): void {
    this.events.push(event);
  }
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  const fixture = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$")));

  const store = new MemoryStore();
  const bus = new RecordingBus();
  const nestchat = new NestChatService(store, bus);
  const provider = new NestChatProvider(bus, new CustomerPushService(store, bus));

  // The rich case on purpose. A bare "hello" would match a fixture with none of
  // the optional keys in it, and the keys that go missing in a rename are
  // precisely the optional ones — so the thread carries a message worth quoting,
  // the reply quotes it, the reply has a recording on it, and somebody has
  // reacted. Every field the contract claims is exercised by one send.
  const quoted = {
    id: "msg_1",
    conversationId: "conv_1",
    direction: "in",
    authorType: "contact",
    body: "Is it the house on the corner?",
    createdAt: "2026-09-18T12:00:00.000Z",
    internal: false,
    attachments: [{ id: "att_0", filename: "door.jpg", mime: "image/jpeg", kind: "image" }],
    reactions: [],
  } as unknown as Message;

  const reply = {
    id: "msg_2",
    conversationId: "conv_1",
    direction: "out",
    authorType: "user",
    authorName: "Nathan",
    body: "Yes — it's the one with the blue door",
    createdAt: "2026-09-18T12:01:00.000Z",
    internal: false,
    quotedMsgId: "msg_1",
    attachments: [
      {
        id: "att_1",
        filename: "voice.webm",
        mime: "audio/webm",
        kind: "voice",
        durationMs: 7400,
        waveform: [0.1, 0.55, 0.9, 0.42, 0.18],
      },
    ],
    reactions: [{ emoji: "\u2764\ufe0f", by: "contact" }],
  } as unknown as Message;

  const conversation = {
    id: "conv_1",
    inboxId: "inbox_1",
    messages: [quoted, reply],
  } as unknown as Conversation;

  console.log("\nWhat the server publishes\n");

  // Every event, from the code that really emits it — not from a literal here,
  // which would be the same mistake one level up.
  await provider.sendText({
    to: "v",
    body: reply.body,
    conversation,
    authorName: "Nathan",
    messageId: reply.id,
  });
  await provider.sendReaction({
    conversation,
    channelMsgId: "",
    messageId: reply.id,
    emoji: "\u2764\ufe0f",
  });
  await provider.sendTyping({ conversation });
  await provider.markRead({ conversation });
  nestchat.publishStatusToVisitor(conversation.id, "closed");
  nestchat.publishStatusToVisitor(conversation.id, "open");

  const emitted = new Map(bus.events.map((e) => [e.kind, e]));
  ok("every kind in the fixture is one the server emits",
    Object.keys(fixture).every((k) => emitted.has(k as VisitorEvent["kind"])),
    `emitted: ${[...emitted.keys()].join(", ")}`);
  ok("and every kind the server emits is in the fixture",
    // The direction that catches a *new* event nobody told the SDK about.
    [...emitted.keys()].every((k) => k in fixture),
    `fixture: ${Object.keys(fixture).join(", ")}`);

  for (const [kind, sample] of Object.entries(fixture)) {
    const actual = emitted.get(kind as VisitorEvent["kind"]);
    if (!actual) continue;
    const want = shapeOf(sample);
    const got = shapeOf(JSON.parse(JSON.stringify(actual)));
    ok(`"${kind}" matches the contract`, show(want) === show(got),
      show(want) === show(got) ? "" : `contract ${show(want)} vs server ${show(got)}`);
  }

  console.log("\nThe keys the bug turned on\n");
  const message = emitted.get("message");
  ok("an event says `kind`, never `type`",
    // Spelled out because this is the exact pair that was wrong, and a shape
    // comparison alone would let somebody "fix" the fixture to match a rename.
    !!message && "kind" in message && !("type" in (message as object)));
  ok("a message carries `payload`, never `message`",
    !!message && "payload" in message && !("message" in (message as object)));

  console.log("\nA message's own fields\n");
  const payload = (message as { payload?: Record<string, unknown> } | undefined)?.payload;
  for (const field of ["id", "from", "body", "at"]) {
    ok(`carries ${field}`, !!payload && field in payload);
  }
  ok("`from` says who it is from", payload?.from === "agent");

  console.log("\nWhat the visitor is allowed to see\n");
  const internal = { id: "m_2", internal: true, direction: "out", body: "note to self" } as unknown as Message;
  ok("an internal note is never sent to a customer",
    // The one that would be a leak rather than a dropped frame.
    nestchat.toVisitorMessage(internal) === undefined);

  console.log("\nA quote is a copy of somebody's words\n");
  const thread = [quoted, reply];
  ok(
    "the reply carries what it answers",
    nestchat.toVisitorMessage(reply, thread)?.quote?.preview === "Is it the house on the corner?",
  );
  ok(
    "and what the original was, when it had no words",
    // A photo quoted under a reply has nothing to print. Without the kind the
    // quote renders as an empty box, which reads as broken rather than as a
    // picture.
    nestchat.toVisitorMessage(reply, thread)?.quote?.kind === "image",
  );
  ok(
    "an id from another conversation is not quoted",
    // The whole risk in quoting: the id arrives from the client, and a lookup
    // that trusts it renders a stranger's message inside the reply.
    nestchat.toVisitorMessage(reply, [reply])?.quote === undefined,
  );
  ok(
    "and neither is an internal note",
    nestchat.toVisitorMessage(reply, [
      { ...quoted, internal: true } as unknown as Message,
      reply,
    ])?.quote === undefined,
  );
  ok(
    "a long one is trimmed rather than sent whole",
    (() => {
      const long = { ...quoted, body: "x".repeat(400) } as unknown as Message;
      const preview = nestchat.toVisitorMessage(reply, [long, reply])?.quote?.preview ?? "";
      return preview.length <= NESTCHAT_QUOTE_PREVIEW_MAX && preview.endsWith("\u2026");
    })(),
  );

  console.log("\nWhose reaction is whose\n");
  ok(
    "the customer's own reads as the visitor's",
    // Stored from the desk's point of view, read from the phone's. Getting
    // this backwards puts the highlight on the wrong emoji — the visitor sees
    // their own tap as somebody else's.
    nestchat.toVisitorMessage(reply, thread)?.reactions[0]?.by === "visitor",
  );
  ok(
    "an agent's reads as the agent's",
    nestchat.toVisitorMessage(
      { ...reply, reactions: [{ emoji: "\ud83d\udc4d", by: "user" }] } as unknown as Message,
      thread,
    )?.reactions[0]?.by === "agent",
  );
  ok(
    "a message nobody reacted to still has the key",
    Array.isArray(nestchat.toVisitorMessage(quoted, thread)?.reactions),
  );

  console.log("\nA voice note keeps its shape\n");
  const voice = nestchat.toVisitorMessage(reply, thread)?.attachments?.[0];
  ok("it is marked as a recording, not as audio", voice?.kind === "voice");
  ok("it knows how long it runs", voice?.durationMs === 7400);
  ok(
    "and carries the bars the recorder drew",
    // Measured once, while it was being made. The alternative is every reader
    // decoding the whole file to arrive at the same shape.
    Array.isArray(voice?.waveform) && voice!.waveform!.length === 5,
  );
  ok(
    "an ordinary file carries neither",
    (() => {
      const att = nestchat.toVisitorMessage(quoted, thread)?.attachments?.[0];
      return att?.durationMs === undefined && att?.waveform === undefined;
    })(),
  );

  await bus.onModuleDestroy();
  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
