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
import { mapContact } from "../apps/api/src/data/mappers";
import { NestChatController } from "../apps/api/src/channels/nestchat/nestchat.controller";
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

  /* ---- the endpoint, not the pieces ---- */

  console.log("\nWhat a real session actually writes\n");
  // Driven through the controller rather than the service. Every assertion
  // above passed while the endpoint was dropping the channel's tag on the
  // floor: the units were right and the wiring was not, which is precisely the
  // gap a check on the pieces cannot see. `appSession` touches only the two
  // dependencies given here; the other four are for routes this does not call.
  const controller = new NestChatController(
    nestchat,
    store,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const appKey = await nestchat.ensureAppKey(inbox.id);

  const unsigned = await controller.appSession(appKey, {
    externalId: "u_7001",
    name: "Marta Nowak",
    email: "marta@example.com",
    phone: "+447700900111",
  });
  ok("an unsigned claim opens anonymously", unsigned.identified === false);

  const anonContact = (await store.listContacts()).find((c) => c.displayName.startsWith("Visitor"));
  ok("and the details it sent are not written", !!anonContact && anonContact.displayName !== "Marta Nowak");
  ok(
    "no email lands on the record either",
    // The rule worth keeping: a matching email is what merges a session onto a
    // customer we already hold, so an unverified caller writing one is an
    // impersonation route, not a convenience.
    !!anonContact && !anonContact.email,
  );
  ok(
    "but the channel's tag still goes on",
    // This was the bug. The setting says "a tag put on every contact this
    // channel creates" and it only ever went on verified ones — so a business
    // whose app was not signing yet could not find its own customers by the
    // tag that exists to find them. Where somebody came from is not a claim
    // about who they are.
    anonContact?.tags.includes("Ding app") === true,
  );

  const diagnostics = await store.listWebhookDiagnostics(10);
  ok(
    "and somebody is told it happened",
    // Silence here is what let an app run for weeks filing every customer as
    // "Visitor" and six hex digits with nobody able to say why.
    diagnostics.some((d) => d.kind.startsWith("app_identity_")),
    diagnostics[0]?.kind ?? "nothing recorded",
  );

  const signedIn = await controller.appSession(appKey, {
    externalId: "u_7002",
    // `rolled`, not `secret`: the check rotates the channel's secret further up,
    // and signing with the old one is exactly the "no" this file asserts elsewhere.
    userHash: sign(rolled, "u_7002"),
    name: "Sam Patel",
    email: "sam@example.com",
  });
  ok("a signed claim is believed", signedIn.identified === true);
  const known = (await store.listContacts()).find((c) => c.displayName === "Sam Patel");
  ok("the name is theirs", !!known);
  ok("the email is recorded", known?.email === "sam@example.com");
  ok("and they are tagged too", known?.tags.includes("Ding app") === true);

  console.log("\nThe same person, twice\n");
  // The one that was missing, and it took production down for the app channel.
  // A verified user is stored under the `external` identity kind, and the
  // contact lookup matched on `phone`/`wa_id` for anything it did not recognise
  // — so the second login never found the first, tried to insert a duplicate,
  // and threw. Every check here passed throughout, because none of them logged
  // the same person in twice.
  const againA = await controller.appSession(appKey, {
    externalId: "u_7003",
    userHash: sign(rolled, "u_7003"),
    name: "Priya Shah",
  });
  const againB = await controller.appSession(appKey, {
    externalId: "u_7003",
    userHash: sign(rolled, "u_7003"),
    name: "Priya Shah",
  });
  ok("signing in again works at all", againA.identified && againB.identified);
  const priya = (await store.listContacts()).filter((c) => c.displayName === "Priya Shah");
  ok(
    "and resumes the same customer rather than forking one",
    // The whole point of keying on the app's own user id: a reinstall, a new
    // phone, or simply opening the chat tomorrow is the same person.
    priya.length === 1,
    `${priya.length} contact(s)`,
  );

  console.log("\nReplying to them\n");
  // The third place `external` had to be taught about, found the same way as
  // the first two: in production, by somebody trying to use the feature. A
  // verified app customer is stored under the `external` kind, and a contact's
  // chat address was read only from `nestchat` — so an agent pressing send was
  // told the conversation had no address, which was true and no help at all.
  const signedInContact = (await store.listContacts()).find((c) => c.displayName === "Sam Patel");
  ok(
    "a signed-in customer has a chat address",
    // What the dispatcher addresses a NestChat reply to. Without it the send is
    // refused before it reaches the channel.
    Boolean(signedInContact?.visitorId),
    signedInContact?.visitorId ?? "none",
  );
  ok(
    "and it is the identity they were verified under",
    signedInContact?.visitorId === externalIdentity(inbox.id, "u_7002"),
  );

  const anonForReply = (await store.listContacts()).find((c) => c.displayName.startsWith("Visitor"));
  ok(
    "an anonymous one still has theirs",
    // The case that always worked, asserted so widening the lookup cannot
    // quietly take it away.
    Boolean(anonForReply?.visitorId),
  );

  console.log("\nThe same, on the row shape Postgres returns\n");
  // The assertions above run against the in-memory store, which keeps a
  // contact's chat address in a field of its own. Production does not: it
  // derives it from the identity rows, in `mapContact`, and that is the code
  // that was broken. A check that only exercised the memory store would have
  // gone on passing while an agent could not reply to a single app customer —
  // which is exactly what happened.
  const row = (identities: { kind: string; value: string }[]) =>
    mapContact({
      id: "ct_x", orgId: ORG_ID, displayName: "Sam Patel", company: null, avatarColor: null,
      tags: [], ownerUserId: null, ownerTeamId: null, blocked: false, createdAt: new Date(),
      identities: identities.map((i, n) => ({
        id: `ci_${n}`, contactId: "ct_x", orgId: ORG_ID, verified: false,
        normalizedValue: i.value, ...i,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

  ok(
    "a verified app identity is a chat address",
    row([{ kind: "external", value: "inbox_1:u_9" }]).visitorId === "inbox_1:u_9",
  );
  ok(
    "an anonymous one still is",
    row([{ kind: "nestchat", value: "abc123" }]).visitorId === "abc123",
  );
  ok(
    "and where somebody has both, the verified one wins",
    // Happens when a customer chatted anonymously before signing in and the two
    // records were merged. Replying should reach them as who they are now.
    row([
      { kind: "nestchat", value: "abc123" },
      { kind: "external", value: "inbox_1:u_9" },
    ]).visitorId === "inbox_1:u_9",
  );
  ok(
    "a customer with neither has no chat address",
    // The guard in the dispatcher has to keep meaning something: a WhatsApp-only
    // contact must not look replyable on live chat.
    row([{ kind: "phone", value: "+447700900111" }]).visitorId === undefined,
  );

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
