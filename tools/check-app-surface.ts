/**
 * The app surface on a live-chat channel: the key, the secret, and the setting
 * that decides whether a customer gets one conversation or one per order.
 *
 * A live-chat channel can be reached from a website, from an app, or both. They
 * are the same channel — same teams, same routing, same appearance — and the
 * only real differences are who is allowed to claim an identity and which key
 * they present. Everything here is about keeping those two separable.
 *
 * The rules:
 *
 *   1. The app has its own key. Rolling or disabling it must not disturb the
 *      website, and the two must never resolve to each other.
 *   2. The identity secret is shown once and never read back.
 *   3. A thread key must name a real conversation field. A contact field cannot
 *      key a thread — it identifies a person, so every one of their chats would
 *      share a key and a year of unrelated conversations would merge into one.
 *   4. Turning the surface on mints the key, so there is something to paste.
 *
 *     pnpm check:app-surface
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import { DEFAULT_NESTCHAT_APP } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const nestchat = new NestChatService(store, new VisitorBus());

  const site = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "swiftee.co.uk", handle: "swiftee.co.uk",
    teamIds: [], routingStrategy: "manual",
  });
  const app = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Ding app", handle: "ding", teamIds: [],
    routingStrategy: "manual",
  });

  console.log("\nTwo keys, kept apart\n");
  const siteWidget = await nestchat.ensureWidgetKey(site.id);
  const appWidget = await nestchat.ensureWidgetKey(app.id);
  const appKey = await nestchat.ensureAppKey(app.id);
  ok("the app key is not the widget key", appKey !== appWidget, `${appKey.slice(0, 6)}… vs ${appWidget.slice(0, 6)}…`);
  ok("each resolves to its own channel", (await store.getInboxByAppKey(appKey))?.id === app.id);
  // The whole reason they are separate: one must not open the other's door.
  ok("an app key is not a widget key", (await store.getInboxByWidgetKey(appKey)) === undefined);
  ok("and a widget key is not an app key", (await store.getInboxByAppKey(siteWidget)) === undefined);
  ok("minting again is stable", (await nestchat.ensureAppKey(app.id)) === appKey);

  console.log("\nThe identity secret\n");
  ok("a channel starts without one", (await nestchat.hasIdentitySecret(app.id)) === false);
  const secret = await nestchat.rotateIdentitySecret(app.id);
  ok("minting returns it", secret.length >= 32);
  ok("and the channel now says it has one", (await nestchat.hasIdentitySecret(app.id)) === true);
  const rolled = await nestchat.rotateIdentitySecret(app.id);
  // Rolling has to invalidate what came before, or a leaked secret stays useful.
  ok("rolling replaces it", rolled !== secret);
  const settings = await nestchat.settingsFor(app.id);
  // The settings payload is what a browser holds. It may know a secret exists;
  // it must never carry the secret itself.
  ok("settings say one exists", settings.hasIdentitySecret === true);
  ok(
    "and do not carry it",
    !JSON.stringify(settings).includes(rolled),
    "the secret appeared in the settings payload",
  );

  console.log("\nWhat can key a thread\n");
  await store.createCustomField(ORG_ID, {
    key: "order_id", label: "Order ID", type: "text", entity: "conversation",
    options: [], inboxIds: [],
  });
  await store.createCustomField(ORG_ID, {
    key: "account_no", label: "Account number", type: "text", entity: "contact",
    options: [], inboxIds: [],
  });

  await nestchat.updateApp(app.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, threadFieldKey: "order_id" });
  ok("a conversation field is accepted", (await nestchat.appFor(app.id)).threadFieldKey === "order_id");

  // A contact field identifies a person. Keyed on one, every conversation that
  // customer ever opens shares a key — and a year of unrelated chats becomes
  // one thread.
  ok(
    "a contact field is refused",
    await rejects(() =>
      nestchat.updateApp(app.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, threadFieldKey: "account_no" }),
    ),
  );
  ok(
    "a field nobody defined is refused",
    await rejects(() =>
      nestchat.updateApp(app.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, threadFieldKey: "no_such" }),
    ),
  );
  // Refused means unchanged — a rejected save that half-applied would leave the
  // channel keyed on nothing while the screen still showed the old value.
  ok("a refusal changes nothing", (await nestchat.appFor(app.id)).threadFieldKey === "order_id");
  ok(
    "and none at all is allowed — one ongoing thread per customer",
    !(await rejects(() =>
      nestchat.updateApp(app.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, threadFieldKey: "" }),
    )),
  );

  console.log("\nTurning it on\n");
  const fresh = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Another app", handle: "other", teamIds: [],
    routingStrategy: "manual",
  });
  const before = await nestchat.settingsFor(fresh.id);
  // Nothing to paste while the surface is off, so nothing is shown.
  ok("a channel with the surface off has no app key on screen", before.appKey === undefined);
  await nestchat.updateApp(fresh.id, { ...DEFAULT_NESTCHAT_APP, enabled: true, contactTag: "Ding app" });
  const after = await nestchat.settingsFor(fresh.id);
  ok("enabling mints one", Boolean(after.appKey), String(after.appKey));
  ok("the contact tag is kept", after.app.contactTag === "Ding app");
  ok("and it defaults to verifying when a signature arrives", after.app.identity === "optional");

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
