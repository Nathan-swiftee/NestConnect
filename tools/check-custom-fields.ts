/**
 * Facts a workspace records that we did not think of, and finding them again.
 *
 * The reason this exists is the finding, not the recording. An order number is
 * written once, by an integration, and then read out over the phone by a
 * customer who wants to know where their food is — so the only thing that
 * matters is whether an agent can type what they hear and land on the right
 * thread. Every way that fails is quiet: the value is there, the search says
 * nothing, and the agent concludes the order does not exist.
 *
 * The rules pinned down here:
 *
 *   1. A field's key is its identity, and two fields cannot claim one.
 *   2. A key nobody defined is reported, never stored. A typo in an integration
 *      has to fail where somebody can see it.
 *   3. A reference matches however it was typed: "dg 88412", "DG-88412" and
 *      "dg88412" are one value.
 *   4. Search finds a thread by a value on the thread *and* by a value on the
 *      person — an account number should turn up every chat they have had.
 *   5. Exact beats partial, so the order being read out is not buried under
 *      every order that contains those digits.
 *   6. Archiving keeps the values; deleting is the one that destroys them.
 *   7. What a field belongs to can be corrected. Set up on the customer when an
 *      app needs it on the conversation, the chat drops it without a word —
 *      so the setting must be changeable, and changing it must not strand the
 *      values already recorded: it stops and asks, then clears them.
 *
 *     pnpm check:custom-fields
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID, DEMO_USER_ID } from "../apps/api/src/data/fixtures";
import { normalizeCustomFieldValue } from "../packages/schemas/src/index";
import { CustomFieldsController } from "../apps/api/src/custom-fields/custom-fields.controller";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import type { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const store = new MemoryStore();

  console.log("\nDefining them\n");
  const orderId = await store.createCustomField(ORG_ID, {
    key: "order_id", label: "Order ID", type: "text", entity: "conversation",
    options: [], inboxIds: [],
  });
  const account = await store.createCustomField(ORG_ID, {
    key: "account_no", label: "Account number", type: "text", entity: "contact",
    options: [], inboxIds: [],
  });
  ok("a conversation field and a contact field are different things",
    orderId.entity === "conversation" && account.entity === "contact");

  let clash = false;
  try {
    await store.createCustomField(ORG_ID, {
      key: "order_id", label: "Order reference", type: "text", entity: "conversation",
      options: [], inboxIds: [],
    });
  } catch {
    clash = true;
  }
  // The key is what an SDK sends. Two fields claiming it would make one payload
  // mean two different things depending on which row was read first.
  ok("a second field cannot claim the same key", clash);

  console.log("\nRecording a value\n");
  // Named fixtures rather than a view: a view is scoped to a user's teams,
  // and what is being tested here is the field, not the membership rules.
  const conv = (await store.getConversation("conv_north"))!;
  const written = await store.setCustomFieldValues(ORG_ID, "conversation", conv.id, {
    order_id: "DG-88412",
  });
  ok("it comes back on the record", written.values.find((v) => v.key === "order_id")?.value === "DG-88412");
  ok("and nothing was reported unknown", written.unknown.length === 0);

  const typo = await store.setCustomFieldValues(ORG_ID, "conversation", conv.id, {
    ordr_id: "DG-99999",
  });
  // Loudly, at the point the integration is written — not as a year of values
  // filed under a name no screen will ever read.
  ok("a key nobody defined is reported", typo.unknown.includes("ordr_id"));
  ok("and is not stored", !typo.values.some((v) => v.value === "DG-99999"));

  console.log("\nHowever they type it\n");
  const shapes = ["DG-88412", "dg 88412", "dg88412", " DG/88412 ", "Dg_88412"];
  ok(
    "every shape of the same reference folds together",
    new Set(shapes.map(normalizeCustomFieldValue)).size === 1,
    [...new Set(shapes.map(normalizeCustomFieldValue))].join(" / "),
  );
  for (const typed of shapes) {
    const hits = await store.findByCustomFieldValue(ORG_ID, "conversation", typed);
    ok(`"${typed}" finds the thread`, hits.includes(conv.id));
  }

  console.log("\nSearch\n");
  let results = await store.searchConversations("DG-88412");
  ok("the thread turns up by the order it is about", results.items.some((c) => c.id === conv.id));

  // A value on the *person*, which should surface every conversation they have
  // ever had rather than only the one it was typed on.
  await store.setCustomFieldValues(ORG_ID, "contact", conv.contact.id, { account_no: "AC 7781" });
  results = await store.searchConversations("ac7781");
  ok(
    "and by a value recorded against the customer",
    results.items.some((c) => c.contact.id === conv.contact.id),
    `${results.items.length} result(s)`,
  );

  // Nothing carrying the value means nothing found — a search that fell back to
  // returning everything would be worse than one that returned nothing.
  results = await store.searchConversations("DG-00000");
  ok("an order nobody has finds nothing", results.items.length === 0);

  console.log("\nExact before partial\n");
  const other = (await store.getConversation("conv_bloom"))!;
  await store.setCustomFieldValues(ORG_ID, "conversation", other.id, { order_id: "DG-884120" });
  const ranked = await store.findByCustomFieldValue(ORG_ID, "conversation", "DG-88412");
  ok("both match", ranked.length === 2, ranked.join(", "));
  // The one being read out is the one that was asked for. A longer reference
  // that happens to contain it is a different order.
  ok("the exact one comes first", ranked[0] === conv.id, ranked[0]);

  console.log("\nRetiring one\n");
  await store.updateCustomField(orderId.id, { archived: true });
  let still = await store.customFieldValues(ORG_ID, "conversation", [conv.id]);
  ok("archiving keeps what was recorded", still.get(conv.id)?.some((v) => v.key === "order_id") === true);
  const onArchived = await store.setCustomFieldValues(ORG_ID, "conversation", conv.id, {
    order_id: "DG-11111",
  });
  ok("but nothing new can be written to it", onArchived.unknown.includes("order_id"));

  await store.deleteCustomField(orderId.id);
  still = await store.customFieldValues(ORG_ID, "conversation", [conv.id]);
  // The destructive one, and the reason the screen that calls it asks first.
  ok("deleting takes the values with it", !still.get(conv.id)?.some((v) => v.key === "order_id"));

  await changingWhatItBelongsTo(store);

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Rule 7, through the real controller and the chat's own field check. */
async function changingWhatItBelongsTo(store: MemoryStore): Promise<void> {
  console.log("\nCorrecting what a field belongs to\n");
  const fields = new CustomFieldsController(store);
  const chat = new NestChatService(store, {} as VisitorBus);
  const inbox = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "App chat", handle: "app", teamIds: ["team_support"],
    routingStrategy: "manual",
  });
  const status = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return 200;
    } catch (err) {
      return (err as { getStatus?: () => number }).getStatus?.() ?? 500;
    }
  };

  // The mistake as it happens: an app's field set up on the customer.
  const appId = await store.createCustomField(ORG_ID, {
    key: "application_id", label: "Application ID", type: "text", entity: "contact",
    options: [], inboxIds: [],
  });
  const before = await chat.validateFields(inbox.id, { application_id: "APP-1" });
  ok("on the customer, the chat drops what an app sends", before.unknown.includes("application_id") && !before.values.application_id);

  ok("an agent can't change it", (await status(() => fields.update("usr_james", appId.id, { entity: "conversation" }))) === 403);
  const moved = await fields.update(DEMO_USER_ID, appId.id, { entity: "conversation" });
  ok("an admin can, when nothing is recorded on it", moved.entity === "conversation");
  const after = await chat.validateFields(inbox.id, { application_id: "APP-1" });
  ok("and the chat now takes it", after.values.application_id === "APP-1" && after.unknown.length === 0);

  // Values recorded on one kind of record can't follow to the other.
  await store.setCustomFieldValues(ORG_ID, "conversation", "conv_north", { application_id: "APP-2" });
  ok("with a value recorded, a move is stopped and says so",
    (await status(() => fields.update(DEMO_USER_ID, appId.id, { entity: "contact" }))) === 409);
  ok("and nothing changed",
    (await store.listCustomFields(ORG_ID)).find((f) => f.id === appId.id)?.entity === "conversation" &&
      (await store.countCustomFieldValues(appId.id)) === 1);
  const cleared = await fields.update(DEMO_USER_ID, appId.id, { entity: "contact", discardValues: true });
  ok("told to clear them, it moves", cleared.entity === "contact");
  ok("and the values are gone, not left on the wrong kind of record", (await store.countCustomFieldValues(appId.id)) === 0);

  // An ordinary edit can't move it by the back door.
  await store.updateCustomField(appId.id, { label: "Application ref", entity: "conversation" });
  ok("a plain edit leaves what it belongs to alone",
    (await store.listCustomFields(ORG_ID)).find((f) => f.id === appId.id)?.entity === "contact");

  // A field an app files its chats by has to stay on the conversation.
  const order = await store.createCustomField(ORG_ID, {
    key: "booking_ref", label: "Booking ref", type: "text", entity: "conversation",
    options: [], inboxIds: [],
  });
  await chat.updateApp(inbox.id, { enabled: true, contactTag: "", threadFieldKey: "booking_ref", identity: "optional" });
  ok("the field a chat threads by can't be moved to the customer",
    (await status(() => fields.update(DEMO_USER_ID, order.id, { entity: "contact" }))) === 400);
}

// As a request would: inside the workspace under test (see tenancy/tenant-scope.ts).
void runInTenant(ORG_ID, main);
