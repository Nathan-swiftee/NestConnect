/**
 * Ringing a customer's phone.
 *
 * The agent app's push rules are about *which* of a dozen conversations is
 * worth interrupting someone for. A customer has one conversation and one
 * question — did anybody answer me — so almost none of that applies, and what
 * is left is a much shorter list that has to be right:
 *
 *   1. Never push what is already on screen. A reply arriving live in an open
 *      chat *and* as a banner over the top of it is the single thing that makes
 *      people turn notifications off for good.
 *   2. Push through the business's own Firebase project or not at all. A
 *      channel with no credential stays quiet rather than falling back to a
 *      project the customer has never heard of.
 *   3. A token belongs to one contact on one channel. A handset that changes
 *      hands moves; it never ends up addressable by two people.
 *   4. A dead address is disabled and a flaky one is not — disabling on a blip
 *      at Google's end stops notifying a customer for good, silently.
 *   5. Six short replies in a row are one buzz, not six.
 *
 *     pnpm check:customer-push
 */
import type { Conversation } from "../packages/schemas/src/index";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { CustomerPushService, preview } from "../apps/api/src/channels/nestchat/customer-push.service";
import {
  FcmSender,
  isDeadToken,
  parseServiceAccount,
  type FcmMessage,
  type FcmResult,
} from "../apps/api/src/channels/nestchat/fcm";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** A service-account JSON of the shape Firebase hands out. The key is a real
 *  PEM header and nothing else — nothing here signs anything. */
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "ding-prod",
  client_email: "push@ding-prod.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEvQ==\\n-----END PRIVATE KEY-----\\n",
});

/** Stands in for Google: records what it was asked to send, answers as told. */
class FakeSender extends FcmSender {
  readonly sent: FcmMessage[] = [];
  answer: (m: FcmMessage) => FcmResult = (m) => ({ token: m.token, ok: true });

  override async send(_cred: unknown, message: FcmMessage): Promise<FcmResult> {
    this.sent.push(message);
    return this.answer(message);
  }
}

/** The service with Google replaced. Everything under test happens before the
 *  send, so this changes nothing about the decisions. */
class TestPush extends CustomerPushService {
  protected override readonly fcm = new FakeSender();
  get fake(): FakeSender {
    return this.fcm as FakeSender;
  }
}

async function main(): Promise<void> {
  console.log("\nReading a service account\n");
  const cred = parseServiceAccount(SERVICE_ACCOUNT);
  ok("a real one parses", cred?.projectId === "ding-prod");
  ok(
    "escaped newlines become newlines",
    // A key pasted through a form arrives with its newlines escaped. Left as
    // `\n` the PEM is one long line and signing fails saying nothing useful.
    (cred?.privateKey ?? "").includes("\n") && !(cred?.privateKey ?? "").includes("\\n"),
  );
  ok("nothing at all is nothing", parseServiceAccount("") === null && parseServiceAccount(undefined) === null);
  ok("a paste that isn't JSON is refused", parseServiceAccount("{oops") === null);
  ok(
    "the client config, pasted by mistake, is refused",
    // google-services.json sits next to the service account in the console and
    // looks enough like it to paste. It has no private key, so it can never
    // send — better a message on the screen than notifications that never come.
    parseServiceAccount(JSON.stringify({ project_id: "ding-prod", project_number: "1234" })) === null,
  );
  ok(
    "a service account with no key is refused",
    parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "a@b", private_key: "" })) === null,
  );

  console.log("\nWhich failures mean the address is gone\n");
  ok("an uninstalled app does", isDeadToken("UNREGISTERED"));
  ok("a malformed token does", isDeadToken("INVALID_ARGUMENT"));
  ok("Google having a moment does not", !isDeadToken("UNAVAILABLE") && !isDeadToken("INTERNAL"));
  ok("a quota problem does not", !isDeadToken("QUOTA_EXCEEDED"));
  ok("a transport failure does not", !isDeadToken("transport") && !isDeadToken(undefined));

  console.log("\nWhat the lock screen says\n");
  ok("the message, when there is one", preview("Your driver is two minutes away", 0) === "Your driver is two minutes away");
  ok("one line, whatever the agent typed", !preview("two\n\nlines", 0).includes("\n"));
  ok("a long reply is a preview, not the whole thing", preview("x".repeat(400), 0).length <= 180);
  ok("a file with no words describes itself", preview("", 1) === "Sent a file");
  ok("and says how many", preview("  ", 3) === "Sent 3 files");
  ok("and never says nothing at all", preview("", 0) === "New message");

  /* ---- the decision ---- */

  const store = new MemoryStore();
  const bus = new VisitorBus();
  const push = new TestPush(store, bus);

  const inbox = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Ding app", handle: "ding",
    teamIds: [], routingStrategy: "manual",
  });
  const other = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Ding riders", handle: "riders",
    teamIds: [], routingStrategy: "manual",
  });
  const { contact } = await store.createContact({
    orgId: ORG_ID, displayName: "Marta", phone: "+447700900111",
  });
  const conversation = {
    id: "conv_1", inboxId: inbox.id, contact: { id: contact.id }, status: "open",
  } as unknown as Conversation;

  const reply = { conversation, authorName: "Nathan", body: "On its way" };

  console.log("\nWhen a reply rings a phone\n");
  ok(
    "not with no phone registered",
    (await push.notifyAndWait(reply)).skipped === "no_devices",
  );

  await store.registerCustomerDevice({
    orgId: ORG_ID, contactId: contact.id, inboxId: inbox.id,
    token: "fcm_marta_phone", platform: "android",
  });
  ok(
    "not with no Firebase project on the channel",
    // Their app, their icon, their tray. Ours would be a notification from a
    // company the customer has never installed.
    (await push.notifyAndWait(reply)).skipped === "not_configured",
  );

  await store.updateInbox(inbox.id, { channelConfig: { fcmServiceAccount: SERVICE_ACCOUNT } });
  const first = await push.notifyAndWait(reply);
  ok("with both, it goes", first.sent === 1 && first.skipped === "");
  const sent = push.fake.sent[0];
  ok("addressed to the phone that registered", sent?.token === "fcm_marta_phone");
  ok("titled with whoever answered", sent?.title === "Nathan");
  ok("carrying the thread to open on tap", sent?.data?.conversationId === "conv_1");
  ok(
    "every data value a string",
    // FCM rejects the whole send if one is a number — a 400 for the message,
    // not a warning about the field.
    Object.values(sent?.data ?? {}).every((v) => typeof v === "string"),
  );
  ok(
    "collapsing on the conversation",
    // One chat is one entry in the tray. Without this a burst of replies is a
    // stack of banners for the same conversation.
    sent?.collapseKey === "nest:conv_1",
  );

  console.log("\nThe rule that matters\n");
  const stop = bus.subscribe("conv_1", () => {});
  ok(
    "a chat open in front of them is not pushed",
    (await push.notifyAndWait(reply)).skipped === "watching",
  );
  stop();

  console.log("\nA burst of replies\n");
  push.fake.sent.length = 0;
  const bursts = [await push.notifyAndWait(reply), await push.notifyAndWait(reply), await push.notifyAndWait(reply)];
  ok(
    "the limit is reached and the rest wait",
    // One already went above, so two more make three and the next is held.
    bursts.map((r) => r.skipped).join(",") === ",,rate_limited",
    bursts.map((r) => r.skipped || "sent").join(", "),
  );

  console.log("\nWhose phone it is\n");
  ok(
    "a reply on one app does not ring another",
    (await store.customerDevicesFor(contact.id, other.id)).length === 0,
  );

  const { contact: mate } = await store.createContact({
    orgId: ORG_ID, displayName: "Sam", phone: "+447700900222",
  });
  await store.registerCustomerDevice({
    orgId: ORG_ID, contactId: mate.id, inboxId: inbox.id,
    token: "fcm_marta_phone", platform: "android",
  });
  ok(
    "a handset that changes hands moves rather than doubling",
    // The token is the address. Two rows for one address means the last
    // person's replies arriving on the new owner's lock screen.
    (await store.customerDevicesFor(contact.id, inbox.id)).length === 0 &&
      (await store.customerDevicesFor(mate.id, inbox.id)).length === 1,
  );

  ok(
    "a token can only be dropped by the contact holding it",
    (await store.deleteCustomerDevice(contact.id, "fcm_marta_phone")) === false,
  );

  console.log("\nAn address that stops working\n");
  await store.registerCustomerDevice({
    orgId: ORG_ID, contactId: contact.id, inboxId: inbox.id,
    token: "fcm_dead", platform: "ios",
  });
  push.fake.answer = (m) => ({ token: m.token, ok: false, error: "UNREGISTERED" });
  // Past the rate limit from the burst above: a different conversation.
  const uninstalled = { ...reply, conversation: { ...conversation, id: "conv_2" } as Conversation };
  await push.notifyAndWait(uninstalled);
  ok(
    "an uninstalled app stops being addressed",
    (await store.customerDevicesFor(contact.id, inbox.id)).length === 0,
  );

  await store.registerCustomerDevice({
    orgId: ORG_ID, contactId: contact.id, inboxId: inbox.id,
    token: "fcm_flaky", platform: "ios",
  });
  push.fake.answer = (m) => ({ token: m.token, ok: false, error: "UNAVAILABLE" });
  await push.notifyAndWait({ ...reply, conversation: { ...conversation, id: "conv_3" } as Conversation });
  ok(
    "a blip at Google's end does not",
    // Disabling here is how a customer silently stops being notified for good
    // because of thirty seconds of trouble at the other end.
    (await store.customerDevicesFor(contact.id, inbox.id)).length === 1,
  );

  ok(
    "re-registering brings a disabled address back",
    // The app was reinstalled and Firebase handed out the same token. It is
    // demonstrably alive, which is exactly what the disable was denying.
    await (async () => {
      await store.disableCustomerDevice("fcm_flaky", "UNREGISTERED");
      await store.registerCustomerDevice({
        orgId: ORG_ID, contactId: contact.id, inboxId: inbox.id,
        token: "fcm_flaky", platform: "ios",
      });
      return (await store.customerDevicesFor(contact.id, inbox.id)).length === 1;
    })(),
  );

  await bus.onModuleDestroy();
  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
