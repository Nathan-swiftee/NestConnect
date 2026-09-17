/**
 * Filtering an inbox by a custom field.
 *
 * Search answers "which thread is DG-88412". This answers "show me the threads
 * with an order number at all" — the working set rather than the lookup, and
 * the last thing the custom-fields plan promised and had not shipped.
 *
 * The rules that matter, all of them about what a filter must never do:
 *
 *   1. It narrows the view, never widens it. A filter that reached outside the
 *      inbox you are standing in would show threads you cannot act on, and
 *      quietly hand somebody rows from a team they are not on.
 *   2. Matching nothing shows nothing. The failure here is specific and easy to
 *      write: an empty set of ids, ORed in, matches *everything* — so a filter
 *      that found nothing would look exactly like no filter at all.
 *   3. A field on the person filters their conversations too. "Customers with
 *      an account number" and "threads about an order" are one gesture.
 *   4. "Has a value" and "has this value" are different questions, and a value
 *      that folds away to nothing is the second one, not the first.
 *   5. However it was typed. `dg 88412` filters to `DG-88412`, like search.
 *   6. A chip is opt-in. Defining a field and offering a permanent filter for
 *      it are different decisions, and a row that grows a chip every time
 *      somebody adds a field is a row nobody reads. Turning the chip off must
 *      not stop the field being searchable or recordable — only unlisted.
 *
 *     pnpm check:field-filter
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  await store.createCustomField(ORG_ID, {
    key: "order_id", label: "Order ID", type: "text", entity: "conversation",
    options: [], inboxIds: [],
  });
  await store.createCustomField(ORG_ID, {
    key: "account_no", label: "Account number", type: "text", entity: "contact",
    options: [], inboxIds: [],
  });

  const ids = async (field?: { key: string; value?: string }) =>
    (await store.listConversations("inbound", DEMO_USER_ID, { field, limit: 100 })).items.map(
      (c) => c.id,
    );

  const unfiltered = await ids();
  ok("the fixtures give us an inbox to narrow", unfiltered.length > 2, `${unfiltered.length} threads`);

  console.log("\nNothing recorded yet\n");
  ok(
    "a filter that matches nothing shows nothing",
    // The one that bites: an empty `OR: []` matches every row, so a filter
    // finding nothing would render as the unfiltered inbox and read as the
    // filter not working — or worse, as it working and everything matching.
    (await ids({ key: "order_id" })).length === 0,
  );
  ok(
    "a field nobody defined shows nothing either",
    (await ids({ key: "not_a_field" })).length === 0,
  );

  console.log("\nA value on a thread\n");
  const north = (await store.getConversation("conv_north"))!;
  await store.setCustomFieldValues(ORG_ID, "conversation", north.id, { order_id: "DG-88412" });

  ok("the thread with one is the only one shown", (await ids({ key: "order_id" })).join() === north.id);
  ok(
    "and the rest of the inbox is still there without the filter",
    (await ids()).length === unfiltered.length,
  );

  console.log("\nA value on the person\n");
  const bloom = (await store.getConversation("conv_bloom"))!;
  await store.setCustomFieldValues(ORG_ID, "contact", bloom.contact.id, { account_no: "AC-7781" });
  ok(
    "a contact field filters their conversations",
    (await ids({ key: "account_no" })).includes(bloom.id),
  );
  ok(
    "and not everybody else's",
    !(await ids({ key: "account_no" })).includes(north.id),
  );

  console.log("\nOne value rather than any\n");
  const harbour = (await store.getConversation("conv_harbour"))!;
  await store.setCustomFieldValues(ORG_ID, "conversation", harbour.id, { order_id: "DG-99001" });
  ok("any value gives both", (await ids({ key: "order_id" })).length === 2);
  ok(
    "one value gives one",
    (await ids({ key: "order_id", value: "DG-88412" })).join() === north.id,
  );
  ok(
    "however it was typed",
    // Same folding as search: an order number read out over the phone arrives
    // lowercased, spaced, or with the dash dropped.
    (await ids({ key: "order_id", value: "dg 88412" })).join() === north.id,
  );
  ok(
    "a near miss is not a hit",
    // A filter is an equality. `DG-8841` is a different order from `DG-88412`,
    // and the partial matching that helps a search box would be wrong here.
    (await ids({ key: "order_id", value: "DG-8841" })).length === 0,
  );
  ok(
    "a value that folds away filters for nothing, not for everything",
    // "order_id is ''" is not "order_id is set" — treating it as the latter
    // would turn a cleared search box into a silently different question.
    (await ids({ key: "order_id", value: "   " })).length === 0,
  );

  console.log("\nIt can only ever show less\n");
  for (const view of ["inbound", "mine", "unassigned"]) {
    const plain = new Set(
      (await store.listConversations(view, DEMO_USER_ID, { limit: 100 })).items.map((c) => c.id),
    );
    const narrowed = (
      await store.listConversations(view, DEMO_USER_ID, { field: { key: "order_id" }, limit: 100 })
    ).items.map((c) => c.id);
    ok(
      `“${view}” filtered is a subset of “${view}”`,
      narrowed.every((id) => plain.has(id)),
      `${narrowed.length} of ${plain.size}`,
    );
  }

  console.log("\nWhich fields offer a chip\n");
  const defined = await store.listCustomFields(ORG_ID);
  const orderField = defined.find((f) => f.key === "order_id")!;
  ok(
    "a field created without asking gets no chip",
    // The store's own default. The settings form opts new fields in, which is a
    // choice made there and on purpose; anything created by an integration or a
    // migration stays out of the row until somebody says otherwise.
    orderField.filterable === false,
  );

  await store.updateCustomField(orderField.id, { filterable: true });
  ok(
    "turning it on is what puts it there",
    (await store.listCustomFields(ORG_ID)).find((f) => f.key === "order_id")?.filterable === true,
  );

  await store.updateCustomField(orderField.id, { filterable: false });
  ok(
    "turning it off still filters when asked directly",
    // The chip is a listing, not a permission. The API must keep answering —
    // otherwise hiding a chip would quietly break a saved link or an
    // integration that filters by that key.
    (await ids({ key: "order_id" })).length === 2,
  );
  ok(
    "and the values are still recorded and still found",
    (await store.customFieldValues(ORG_ID, "conversation", [north.id])).get(north.id)?.length === 1,
  );

  console.log("\nArchiving a field\n");
  const fields = await store.listCustomFields(ORG_ID);
  const order = fields.find((f) => f.key === "order_id")!;
  await store.updateCustomField(order.id, { archived: true });
  ok(
    "an archived field stops filtering",
    // It is history — the values stay on the records that have them, but it is
    // no longer a question the inbox offers, so it must not answer one either.
    (await ids({ key: "order_id" })).length === 0,
  );

  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
