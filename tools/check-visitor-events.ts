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

  const conversation = { id: "conv_1", inboxId: "inbox_1" } as unknown as Conversation;

  console.log("\nWhat the server publishes\n");

  // Every event, from the code that really emits it — not from a literal here,
  // which would be the same mistake one level up.
  await provider.sendText({ to: "v", body: "Your driver is two minutes away", conversation, authorName: "Nathan" });
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

  await bus.onModuleDestroy();
  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
