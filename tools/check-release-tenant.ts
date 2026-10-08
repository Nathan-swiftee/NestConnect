/** Offline regressions: fake credentials, fetch always intercepted. */
import assert from "node:assert/strict";
import { env } from "../apps/api/src/config/env";
import { resolveWhatsAppCreds } from "../apps/api/src/channels/whatsapp/whatsapp-creds";
import { WhatsAppCloudProvider } from "../apps/api/src/channels/whatsapp/whatsapp.provider";
import { WhatsAppService } from "../apps/api/src/channels/whatsapp/whatsapp.service";
import { tenantScoped, TenantViolationError } from "../apps/api/src/data/tenant-prisma";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { PLATFORM_ORG_ID } from "../apps/api/src/tenancy/platform";

async function main() {
  env.whatsapp.phoneNumberId = "FAKE_PLATFORM_NUMBER";
  env.whatsapp.token = "FAKE_TOKEN";
  let inbox: any = { id: "test", orgId: "org_other", type: "whatsapp" };
  let config: any = {};
  const store: any = { getInbox: async () => inbox, getInboxConfig: async () => config,
    getInboxByWhatsAppPhoneId: async () => inbox };
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { fetches++; return new Response(JSON.stringify({ messages: [{ id: "fake" }] }), { status: 200 }); }) as any;
  try {
    await runInTenant("org_other", async () => {
      assert.equal(await resolveWhatsAppCreds(store, "test"), null, "non-platform must not inherit global sender");
      const provider = new WhatsAppCloudProvider(store);
      const conv: any = { inboxId: "test", orgId: "org_other", contact: { phone: "+447700900101" } };
      await provider.markRead({ conversation: conv, channelMsgId: "fake" });
      await provider.sendTyping({ conversation: conv, channelMsgId: "fake" });
      await provider.sendReaction({ conversation: conv, channelMsgId: "fake", emoji: "👍" });
      await provider.sendText({ conversation: conv, inboxId: "test", to: "+447700900101", message: { body: "fake" } } as any);
      assert.equal(fetches, 0, "all sender side effects must avoid global sender");
      const inbound = new WhatsAppService({} as any, {} as any, store, {} as any, {} as any);
      assert.equal(await (inbound as any).tokenFor("other"), null, "inbound media must not inherit platform token");
    });
    inbox = undefined;
    assert.equal(await runInTenant(PLATFORM_ORG_ID, () => resolveWhatsAppCreds(store, "missing")), null);
    inbox = { id: "test", orgId: "org_other", type: "whatsapp" };
    assert.equal(await runInTenant(PLATFORM_ORG_ID, () => resolveWhatsAppCreds(store, "test")), null, "even platform context cannot adopt foreign inbox");
    inbox = { id: "test", orgId: PLATFORM_ORG_ID, type: "whatsapp" };
    assert.equal((await runInTenant(PLATFORM_ORG_ID, () => resolveWhatsAppCreds(store, "test")))?.phoneNumberId, "FAKE_PLATFORM_NUMBER");
    config = { phoneNumberId: "DIFFERENT_NUMBER" };
    assert.equal(await runInTenant(PLATFORM_ORG_ID, () => resolveWhatsAppCreds(store, "test")), null, "partial config for another number fails closed");
    inbox = { id: "test", orgId: "org_other", type: "whatsapp" };
    config = { phoneNumberId: "OWN_NUMBER", accessToken: "OWN_FAKE_TOKEN" };
    assert.equal((await runInTenant("org_other", () => resolveWhatsAppCreds(store, "test")))?.phoneNumberId, "OWN_NUMBER");
  } finally { globalThis.fetch = original; }

  let extension: any;
  let writes = 0;
  const root: any = { $extends: (x: any) => { if (typeof x === "function") return x(root); extension = x; return {}; },
    user: { count: async (a: any) => a.where.AND[0].id.in.every((id: string) => id === "B_user") ? 1 : 0 },
    team: { count: async (a: any) => a.where.AND[0].id.in.every((id: string) => id === "B_team") ? 1 : 0 } };
  tenantScoped(root);
  const operation = (op: string, data: any) => runInTenant("org_B", () => extension.query.$allModels.$allOperations({ model: "Contact", operation: op,
    args: op === "upsert" ? { where: { id: "B_contact" }, create: data, update: data } : { where: { id: "B_contact" }, data },
    query: async (a: any) => { writes++; return a; } }));
  for (const op of ["create", "update", "updateMany", "createMany", "upsert"]) {
    for (const field of ["ownerUserId", "ownerTeamId"]) {
      await assert.rejects(() => operation(op, { [field]: "A_foreign" }), TenantViolationError);
      if (op === "update") await assert.rejects(() => operation(op, { [field]: { set: "A_foreign" } }), TenantViolationError);
    }
  }
  assert.equal(writes, 0, "cross-tenant owners must never reach the database write");
  await operation("create", { ownerUserId: "B_user", ownerTeamId: "B_team" });
  await operation("update", { ownerUserId: null, ownerTeamId: null });
  assert.equal(writes, 2);
  console.log("release tenant regressions passed (offline, zero real sends)");
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
