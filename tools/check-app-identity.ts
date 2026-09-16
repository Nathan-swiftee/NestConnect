/**
 * Who an app says its user is, and whether we believe it.
 *
 * A widget on a public page has nobody to verify: everyone is a stranger and
 * the worst a made-up name costs is a mislabelled thread. An app is the
 * opposite. It knows exactly who is holding the phone, its key is in a binary
 * anybody can pull apart, and the details it sends — an email above all — are
 * what merge a session onto a customer record we already have. Believed
 * without proof, that is an impersonation endpoint.
 *
 * So: the channel says how hard to check, and the answer changes what the
 * session *is* rather than only whether it succeeds.
 *
 *   1. A signature is HMAC-SHA256 of the user id under the channel's secret.
 *      Wrong, absent, or made with a rolled secret — all the same "no".
 *   2. `required` refuses an unsigned claim. `optional` lets it through as an
 *      anonymous session, carrying none of the details it sent.
 *   3. A verified user is keyed by the app's own id, namespaced per channel, so
 *      history survives a reinstall and two apps never collide.
 *   4. The thread key decides one conversation or one per order, and it matches
 *      exactly — "DG-8841" must not resume "DG-88412".
 *
 *     pnpm check:app-identity
 */
import { createHmac } from "node:crypto";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import { DEFAULT_NESTCHAT_APP, externalIdentity } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const sign = (secret: string, id: string) =>
  createHmac("sha256", secret).update(id).digest("hex");

async function main(): Promise<void> {
  const store = new MemoryStore();
  const nestchat = new NestChatService(store, new VisitorBus());

  const inbox = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Ding app", handle: "ding",
    teamIds: [], routingStrategy: "manual",
  });
  await store.createCustomField(ORG_ID, {
    key: "order_id", label: "Order ID", type: "text", entity: "conversation",
    options: [], inboxIds: [],
  });
  await nestchat.updateApp(inbox.id, {
    ...DEFAULT_NESTCHAT_APP, enabled: true, threadFieldKey: "order_id", contactTag: "Ding app",
  });
  const secret = await nestchat.rotateIdentitySecret(inbox.id);

  console.log("\nThe signature\n");
  ok("a real one verifies", await nestchat.verifyUserHash(inbox.id, "u_9182", sign(secret, "u_9182")));
  ok("a wrong one does not", !(await nestchat.verifyUserHash(inbox.id, "u_9182", sign(secret, "u_0001"))));
  ok("nor does an empty one", !(await nestchat.verifyUserHash(inbox.id, "u_9182", "")));
  ok("nor does rubbish", !(await nestchat.verifyUserHash(inbox.id, "u_9182", "not-hex-at-all")));
  // A signature for one customer must not work for another, which is the
  // entire attack: take your own valid hash, send somebody else's id.
  ok(
    "and one user's signature is not another's",
    !(await nestchat.verifyUserHash(inbox.id, "u_0001", sign(secret, "u_9182"))),
  );

  const other = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Swiftee app", handle: "swiftee",
    teamIds: [], routingStrategy: "manual",
  });
  await nestchat.updateApp(other.id, { ...DEFAULT_NESTCHAT_APP, enabled: true });
  await nestchat.rotateIdentitySecret(other.id);
  ok(
    "a signature from one channel is worthless on another",
    !(await nestchat.verifyUserHash(other.id, "u_9182", sign(secret, "u_9182"))),
  );

  const rolled = await nestchat.rotateIdentitySecret(inbox.id);
  ok("rolling stops the old signatures", !(await nestchat.verifyUserHash(inbox.id, "u_9182", sign(secret, "u_9182"))));
  ok("and starts the new ones", await nestchat.verifyUserHash(inbox.id, "u_9182", sign(rolled, "u_9182")));

  console.log("\nTwo apps, one user id\n");
  const a = externalIdentity(inbox.id, "1");
  const b = externalIdentity(other.id, "1");
  // Both apps number their users from 1. On a table unique across every org,
  // an un-namespaced id would make them the same person — a Ding customer
  // reading a Swiftee customer's chat.
  ok("they are different people", a !== b, `${a} vs ${b}`);

  console.log("\nOne thread per order\n");
  const contact = await store.upsertContactByIdentity({
    orgId: ORG_ID, kind: "external", value: a, displayName: "Marta Kowalska",
  });
  const app = await nestchat.appFor(inbox.id);
  ok(
    "nothing to resume before they have written",
    (await nestchat.threadFor(inbox, contact.id, app, { order_id: "DG-88412" })) === undefined,
  );

  const { conversation: first } = await store.findOrCreateOpenConversation({
    orgId: ORG_ID, inboxId: inbox.id, contact, channel: "nestchat",
  });
  await store.setCustomFieldValues(ORG_ID, "conversation", first.id, { order_id: "DG-88412" });
  ok(
    "the same order resumes its own thread",
    (await nestchat.threadFor(inbox, contact.id, app, { order_id: "DG-88412" })) === first.id,
  );
  ok(
    "typed differently, still the same order",
    (await nestchat.threadFor(inbox, contact.id, app, { order_id: "dg 88412" })) === first.id,
  );
  // A prefix is a different order. Resuming on one would file tonight's
  // complaint under last week's.
  ok(
    "a shorter reference is a different order",
    (await nestchat.threadFor(inbox, contact.id, app, { order_id: "DG-8841" })) === undefined,
  );
  ok(
    "and so is another order entirely",
    (await nestchat.threadFor(inbox, contact.id, app, { order_id: "DG-99999" })) === undefined,
  );
  // Sending no order at all must not join whichever thread happened to be open.
  ok(
    "no order named starts something new",
    (await nestchat.threadFor(inbox, contact.id, app, {})) === undefined,
  );

  console.log("\nWith no thread key, one ongoing conversation\n");
  const ongoing = { ...app, threadFieldKey: "" };
  ok(
    "everything continues the same thread",
    (await nestchat.threadFor(inbox, contact.id, ongoing, { order_id: "DG-99999" })) === first.id,
  );

  console.log("\nFields an integration got wrong\n");
  const checked = await nestchat.validateFields(inbox.id, {
    order_id: "DG-1", ordr_id: "DG-2",
  });
  ok("the real one is kept", checked.values.order_id === "DG-1");
  ok("the typo is named", checked.unknown.includes("ordr_id"));
  ok("and not stored", !("ordr_id" in checked.values));

  console.log("\nThe channel's tag\n");
  await nestchat.applyContactTag(contact.id, "Ding app");
  let tagged = await store.getContact(contact.id);
  ok("goes on the customer", tagged?.tags.includes("Ding app") === true);
  await nestchat.applyContactTag(contact.id, "Ding app");
  tagged = await store.getContact(contact.id);
  ok("once, not twice", tagged?.tags.filter((t) => t === "Ding app").length === 1);
  // Somebody who came through the app and later the website did both.
  await nestchat.applyContactTag(contact.id, "Website");
  tagged = await store.getContact(contact.id);
  ok("and a second channel adds rather than replaces", tagged?.tags.includes("Ding app") === true && tagged?.tags.includes("Website") === true);

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
