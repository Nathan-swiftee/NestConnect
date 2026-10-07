/**
 * A website telling the chat who is signed in.
 *
 * The website half of what check-app-identity.ts pins for apps. A site puts
 * its user in `NestChatSettings.user`, its server signs the id with the
 * channel's secret, and the widget passes both to `POST :widgetKey/session`.
 *
 *   1. Signed correctly, the chat belongs to that user: keyed by their id, the
 *      same on every browser, and the same person an app session for that id
 *      is. Their name and email are written onto the record.
 *   2. Signed wrongly, or not at all, or on a channel with no secret: an
 *      ordinary anonymous visitor. Nothing they claimed is written anywhere —
 *      above all not an email, which is what joins a chat onto a customer we
 *      already know and so onto their history.
 *   3. A browser cannot borrow a real user's id with its own signature.
 *   4. `fields` describe the chat (order_id) for signed-in users and visitors
 *      alike, and a key the channel has never heard of is named, not stored.
 *
 *     pnpm check:website-identity
 */
import { createHmac } from "node:crypto";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { NestChatController } from "../apps/api/src/channels/nestchat/nestchat.controller";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import { DEFAULT_NESTCHAT_APP } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const sign = (secret: string, id: string) => createHmac("sha256", secret).update(id).digest("hex");

async function main(): Promise<void> {
  const store = new MemoryStore();
  const nestchat = new NestChatService(store, new VisitorBus());
  // Only the two dependencies the session routes touch.
  const controller = new NestChatController(
    nestchat,
    store,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  const inbox = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Ding website", handle: "ding-web",
    teamIds: [], routingStrategy: "manual",
  });
  await store.createCustomField(ORG_ID, {
    key: "order_id", label: "Order ID", type: "text", entity: "conversation",
    options: [], inboxIds: [],
  });
  const widgetKey = await nestchat.ensureWidgetKey(inbox.id);
  const contactOf = (token: string) => nestchat.verifyVisitorToken(token).contactId;

  console.log("\nA channel with no signing secret yet\n");
  const early = await controller.session(widgetKey, {
    externalId: "u_100", userHash: "a".repeat(64), name: "Marta Nowak", email: "marta@example.com",
  });
  ok("opens the chat anyway", !!early.token);
  ok("as a visitor, not as the user", early.identified === false);
  ok(
    "and writes no email anywhere",
    !(await store.findContactByIdentity({ orgId: ORG_ID, kind: "email", value: "marta@example.com" })),
  );

  const secret = await nestchat.rotateIdentitySecret(inbox.id);

  console.log("\nA visitor, as before\n");
  const visitor = await controller.session(widgetKey, {});
  ok("is anonymous", visitor.identified === undefined && !!visitor.visitorId);
  const sameBrowser = await controller.session(widgetKey, { visitorId: visitor.visitorId });
  ok("and the same browser is the same visitor", contactOf(sameBrowser.token) === contactOf(visitor.token));

  console.log("\nA signed-in user, signed by the website's server\n");
  const marta = await controller.session(widgetKey, {
    externalId: "u_100",
    userHash: sign(secret, "u_100"),
    name: "Marta Nowak",
    email: "marta@example.com",
    phone: "+447700900123",
  });
  ok("is believed", marta.identified === true);
  const martaId = contactOf(marta.token);
  const record = await store.getContact(martaId);
  ok("under their own name", record?.displayName === "Marta Nowak", record?.displayName);
  const byEmail = await store.findContactByIdentity({ orgId: ORG_ID, kind: "email", value: "marta@example.com" });
  ok("with their email on the record", byEmail?.id === martaId);

  const laptop = await controller.session(widgetKey, {
    visitorId: "someotherbrowserid",
    externalId: "u_100",
    userHash: sign(secret, "u_100"),
  });
  ok("and is the same person on another browser", contactOf(laptop.token) === martaId);

  await nestchat.updateApp(inbox.id, { ...DEFAULT_NESTCHAT_APP, enabled: true });
  const appKey = await nestchat.ensureAppKey(inbox.id);
  const phone = await controller.appSession(appKey, { externalId: "u_100", userHash: sign(secret, "u_100") });
  ok("and in the app — one customer, one history", contactOf(phone.token) === martaId);

  console.log("\nWhat a browser cannot do\n");
  const borrowed = await controller.session(widgetKey, {
    externalId: "u_100",
    userHash: sign(secret, "u_666"),
    email: "marta@example.com",
  });
  ok("use its own signature for somebody else's id", borrowed.identified === false);
  ok("and so cannot reach their chat", contactOf(borrowed.token) !== martaId);

  const unsigned = await controller.session(widgetKey, {
    externalId: "u_100",
    name: "Not Marta",
    email: "marta@example.com",
  });
  ok("claim an id with no signature", unsigned.identified === false && contactOf(unsigned.token) !== martaId);
  ok("or rename the real one", (await store.getContact(martaId))?.displayName === "Marta Nowak");

  const oldSecret = secret;
  const rolled = await nestchat.rotateIdentitySecret(inbox.id);
  const stale = await controller.session(widgetKey, { externalId: "u_100", userHash: sign(oldSecret, "u_100") });
  ok("keep signing in after the secret is replaced", stale.identified === false);
  const fresh = await controller.session(widgetKey, { externalId: "u_100", userHash: sign(rolled, "u_100") });
  ok("while the new secret works", fresh.identified === true && contactOf(fresh.token) === martaId);

  console.log("\nFields that say what the chat is about\n");
  const withOrder = await controller.session(widgetKey, {
    externalId: "u_200",
    userHash: sign(rolled, "u_200"),
    fields: { order_id: "DG-88412", flavour: "spicy" },
  });
  const claims = nestchat.verifyVisitorToken(withOrder.token);
  ok("carry into the chat for a signed-in user", claims.fields?.order_id === "DG-88412");
  ok("and an unknown key is named, not stored", withOrder.unknownFields?.includes("flavour") === true && !claims.fields?.flavour);

  const anonOrder = await controller.session(widgetKey, { fields: { order_id: "DG-1" } });
  ok("and for a visitor too", nestchat.verifyVisitorToken(anonOrder.token).fields?.order_id === "DG-1");

  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
