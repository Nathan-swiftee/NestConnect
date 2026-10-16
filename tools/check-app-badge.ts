/**
 * The number on the app icon.
 *
 * It's meant to say how many things are waiting for you: conversations in My
 * Inbound with something unread, plus team chats with unread messages. It used
 * to be the inbox count alone, set only by the number riding on each push, and
 * wiped to zero by the app whenever the inbox list showed — so it read 0 with
 * unread conversations still there, then jumped on the next notification.
 *
 *   A  The count: inbox unread plus what other sources (Team Chat) add.
 *   B  A silent push brings an iPhone's icon up to date when the number moves —
 *      only when it moves, only to iPhones, with no banner and no sound.
 *   C  Reading a conversation takes it off the icon.
 *   D  A burst of changes in a workspace is one update, not one per change.
 *
 *     pnpm check:app-badge
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { PushService } from "../apps/api/src/push/push.service";
import { ExpoPushProvider } from "../apps/api/src/push/expo-push.provider";
import type { PushMessage, PushProvider } from "../apps/api/src/push/push.provider";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  await store.upsertDevice({ userId: DEMO_USER_ID, pushToken: "ExponentPushToken[iphone]", platform: "ios" });
  await store.upsertDevice({ userId: DEMO_USER_ID, pushToken: "ExponentPushToken[android]", platform: "android" });

  const sent: PushMessage[] = [];
  const provider = {
    send: async (messages: PushMessage[]) => {
      sent.push(...messages);
      return messages.map((m) => ({ ok: true as const, to: m.to, ticketId: `t_${sent.length}` }));
    },
  } as unknown as PushProvider;
  let onChange: ((orgId: string) => void) | null = null;
  const realtime = { onWorkspaceChange: (fn: (orgId: string) => void) => (onChange = fn) } as unknown as RealtimeGateway;
  const svc = new PushService(store, provider, realtime, new SandboxPolicy(store));

  await runInTenant(ORG_ID, async () => {
    console.log("\nA — the count\n");
    const inbox = await store.unreadConversationCount(DEMO_USER_ID);
    ok("there's something unread in My Inbound to start with", inbox > 0, String(inbox));
    ok("without chats, the badge is the inbox count", (await svc.badgeFor(DEMO_USER_ID)) === inbox);
    let chats = 2;
    svc.registerBadgeSource(async () => chats);
    ok("unread team chats are added to it", (await svc.badgeFor(DEMO_USER_ID)) === inbox + 2);
    svc.registerBadgeSource(async () => {
      throw new Error("down");
    });
    ok("a source that fails doesn't take the badge down with it", (await svc.badgeFor(DEMO_USER_ID)) === inbox + 2);

    console.log("\nB — keeping an iPhone's icon right\n");
    await svc.syncBadges();
    ok("one silent update goes out", sent.length === 1, JSON.stringify(sent));
    ok("to the iPhone only", sent[0]?.to === "ExponentPushToken[iphone]");
    ok("with the number, and nothing to show or hear", sent[0]?.badge === inbox + 2 && sent[0]?.silent === true);
    sent.length = 0;
    await svc.syncBadges();
    ok("nothing more while the number hasn't moved", sent.length === 0);
    svc.noteBadgeShown(DEMO_USER_ID, inbox + 1);
    await svc.syncBadges();
    ok("if the app set a different number itself, it's put right", sent.length === 1 && sent[0]?.badge === inbox + 2);
    sent.length = 0;

    console.log("\nC — reading takes it off\n");
    const conv = (await store.listConversations("inbound", DEMO_USER_ID, { limit: 50 })).items.find(
      (c) => c.unread || (c.unreadCount ?? 0) > 0,
    );
    ok("found an unread conversation to read", !!conv);
    await store.clearUnread(conv!.id);
    chats = 1;
    await svc.syncBadges();
    ok("reading a conversation and a chat brings the number down by both", sent.length === 1 && sent[0]?.badge === inbox, JSON.stringify(sent.map((m) => m.badge)));
    sent.length = 0;
  });

  console.log("\nD — one update for a burst of changes\n");
  ok("the service listens for workspace changes", typeof onChange === "function");
  await runInTenant(ORG_ID, async () => {
    const first = (await store.listConversations("inbound", DEMO_USER_ID, { limit: 1 })).items[0]!;
    await store.markUnread(first.id);
  });
  for (let i = 0; i < 5; i++) onChange!(ORG_ID);
  await new Promise((r) => setTimeout(r, 1900));
  ok("five changes, one silent update", sent.length === 1, String(sent.length));
  svc.onModuleDestroy();

  console.log("\nE — what a silent update looks like to Expo\n");
  const expo = new ExpoPushProvider(store);
  let posted: unknown = null;
  (expo as unknown as { post: (path: string, body: unknown) => Promise<unknown> }).post = async (_p, body) => {
    posted = body;
    return { data: [{ status: "ok", id: "x" }] };
  };
  await expo.send([{ to: "ExponentPushToken[iphone]", title: "", body: "", badge: 3, silent: true }]);
  const msg = (posted as Array<Record<string, unknown>>)[0]!;
  ok("carries the badge", msg.badge === 3);
  ok("no title, no body, no sound", !("title" in msg) && !("body" in msg) && !("sound" in msg), JSON.stringify(msg));
  await expo.send([{ to: "ExponentPushToken[iphone]", title: "Marta", body: "Any update?" }]);
  const normal = (posted as Array<Record<string, unknown>>)[0]!;
  ok("an ordinary push still has its text and sound", normal.title === "Marta" && normal.sound === "default");

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
