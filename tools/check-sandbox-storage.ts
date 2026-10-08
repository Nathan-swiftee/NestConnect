/** Synthetic bytes + configured fake shared R2; every fetch is intercepted. */
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { StorageService } from "../apps/api/src/storage/storage.service";
import { MediaService } from "../apps/api/src/storage/media.service";
import { MediaController } from "../apps/api/src/storage/media.controller";
import { NestChatController } from "../apps/api/src/channels/nestchat/nestchat.controller";
import { BusinessProfileService } from "../apps/api/src/whatsapp-management/business-profile.service";
import { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import { runInTenant, TenantNotBoundError } from "../apps/api/src/tenancy/tenant-scope";

async function main() {
  let configReads = 0;
  let attachmentWrites = 0;
  const settings: Record<string, string> = { r2_account_id: "fake-account", r2_bucket: "fake-bucket",
    r2_access_key_id: "fake-access-key", r2_secret_access_key: "fake-secret-key" };
  const store: any = {
    isSandboxOrg: async (id: string) => id === "demo",
    getAttachment: async () => ({ storageKey: "fake.png", mime: "image/png", filename: "avatar.png" }),
    getUser: async () => ({ avatarUrl: "/api/media/fake-attachment" }),
    getPlatformSetting: async (key: string) => { configReads++; return settings[key]; },
    createUploadAttachment: async (orgId: string, input: any) => { attachmentWrites++; return { id: "fake-attachment", orgId, ...input }; },
  };
  const policy = new SandboxPolicy(store);
  const storage = new StorageService(store, policy);
  const media = new MediaService(storage, store, policy);
  const controller = new MediaController(store, storage, media);
  const visitor: any = {
    visitor: async () => ({ contactId: "fake-contact" }),
    inboxForWidgetKey: async () => ({ id: "fake-inbox" }),
    servesWidget: async () => true,
    appearanceFor: async () => ({ logoAttachmentId: "fake-attachment" }),
  };
  const widget = new NestChatController(visitor, store, {} as any, {} as any, media, {} as any);
  const profile = new BusinessProfileService(store, policy);
  const file = { buffer: Buffer.from("synthetic image"), size: 15, mimetype: "image/png", originalname: "avatar.png" };
  const attempts: { url: string; method: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    attempts.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    return new Response("synthetic image", { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  const restricted = (err: unknown) => err instanceof ForbiddenException && err.getStatus() === 403 && /demo workspace/.test(err.message);
  try {
    await runInTenant("demo", () => assert.rejects(() => controller.upload(file), restricted));
    await runInTenant("demo", () => assert.rejects(() => widget.upload("Bearer fake", file, {}), restricted));
    await runInTenant("demo", () => assert.rejects(() => widget.avatar("fake-widget", "fake-user", {} as any), restricted));
    await runInTenant("demo", () => assert.rejects(() => widget.logo("fake-widget", {} as any), restricted));
    await runInTenant("demo", () => assert.rejects(() => profile.setPhoto("fake-inbox", file), restricted));
    await runInTenant("demo", () => assert.rejects(() => media.store(file.buffer), restricted));
    await runInTenant("demo", () => assert.rejects(() => media.downloadAndStore("https://provider.example.com/avatar"), restricted));
    await runInTenant("demo", () => assert.rejects(() => storage.put("fake.png", file.buffer), restricted));
    await runInTenant("demo", () => assert.rejects(() => storage.get("fake.png"), restricted));
    await runInTenant("demo", () => assert.rejects(() => storage.presignedGetUrl("fake.png"), restricted));
    assert.equal(attempts.length, 0, "sandbox must not fetch, including swallowed download errors");
    assert.equal(configReads, 0, "sandbox must not resolve shared storage credentials");
    assert.equal(attachmentWrites, 0, "sandbox must not persist upload attachments");
    await assert.rejects(() => storage.put("unbound.png", file.buffer), TenantNotBoundError);
    assert.equal(attempts.length, 0, "unbound uploads must fail closed");
    const uploaded = await runInTenant("live", () => controller.upload(file));
    assert.equal(uploaded.filename, "avatar.png");
    assert.equal(attachmentWrites, 1);
    assert.equal(attempts.length, 1, "live upload reaches the actual R2 driver");
    assert.equal(attempts[0]!.method, "PUT");
    assert.match(attempts[0]!.url, /^https:\/\/fake-account\.r2\.cloudflarestorage\.com\/fake-bucket\//);
    assert.deepEqual(Buffer.from(attempts[0]!.body as Uint8Array), file.buffer);
    // A driver cached by a live call must not bypass policy on a later sandbox call.
    await runInTenant("demo", () => assert.rejects(() => storage.put("after-live.png", file.buffer), restricted));
    assert.equal(attempts.length, 1);
  } finally { globalThis.fetch = original; }
  console.log("sandbox storage regression passed: zero sandbox fetch/config/write; one intercepted live R2 PUT");
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
