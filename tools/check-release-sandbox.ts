/** No network: recording providers and fetch tripwire. */
import assert from "node:assert/strict";
import { ChannelDispatcher } from "../apps/api/src/channels/channel-dispatcher";
import { PushService } from "../apps/api/src/push/push.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { WhatsAppCloudProvider } from "../apps/api/src/channels/whatsapp/whatsapp.provider";

async function main() {
  let live = false;
  const calls: string[] = [];
  const policy: any = { isSandbox: async () => !live, current: async () => !live };
  const provider: any = { supports: () => true, markRead: async () => calls.push("read"),
    sendTyping: async () => calls.push("typing"), sendReaction: async () => calls.push("reaction") };
  const dispatcher = new ChannelDispatcher([provider], {} as any, {} as any, policy);
  const conversation: any = { orgId: "demo", channel: "whatsapp" };
  const original = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = (async () => { networkAttempts++; throw new Error("network forbidden"); }) as any;
  try {
    await dispatcher.markRead(conversation, "fake");
    await dispatcher.sendTyping(conversation, "fake");
    await dispatcher.sendReaction(conversation, "fake", "👍");
    assert.deepEqual(calls, [], "sandbox dispatcher side effects must never call a provider");
    const realDispatcher = new ChannelDispatcher([new WhatsAppCloudProvider({
      getInbox: async () => { throw new Error("sandbox must not look up credentials"); },
    } as any)], {} as any, {} as any, policy);
    await realDispatcher.markRead(conversation, "fake");
    await realDispatcher.sendTyping(conversation, "fake");
    await realDispatcher.sendReaction(conversation, "fake", "👍");
    assert.equal(networkAttempts, 0, "real WhatsApp provider is never reached in sandbox");
    live = true;
    await dispatcher.markRead(conversation, "fake");
    await dispatcher.sendTyping(conversation, "fake");
    await dispatcher.sendReaction(conversation, "fake", "👍");
    assert.deepEqual(calls, ["read", "typing", "reaction"], "live control calls all three");
    calls.length = 0;
    const store: any = { getPushPrefs: async () => undefined,
      devicesForUsers: async () => [{ userId: "reviewer", pushToken: "FAKE" }], unreadConversationCount: async () => 0 };
    const push = new (PushService as any)(store, { send: async () => { calls.push("push"); return []; } },
      { isViewing: async () => false, emitMessageCue: () => {} }, policy);
    live = false;
    for (const kind of ["test", "reminder", "message", "mention", "assignment", "team_message"]) {
      const result = await runInTenant("demo", () => push.notifyAndWait({ userIds: ["reviewer"], kind, title: "fake", body: "fake" }));
      assert.deepEqual(result, { sent: 0, failed: 0 });
    }
    await runInTenant("demo", async () => { push.notify({ userIds: ["reviewer"], kind: "test", title: "fake", body: "fake" });
      await new Promise(r => setTimeout(r, 20)); });
    assert.deepEqual(calls, [], "all sandbox push kinds (including fire-and-forget) have zero provider calls");
    live = true;
    await runInTenant("live", () => push.notifyAndWait({ userIds: ["reviewer"], kind: "test", title: "fake", body: "fake" }));
    assert.deepEqual(calls, ["push"], "live push control is not suppressed");
    assert.equal(networkAttempts, 0, "no external fetch was attempted (including swallowed errors)");
  } finally { globalThis.fetch = original; }
  console.log("release sandbox regressions passed (zero real sends)");
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
