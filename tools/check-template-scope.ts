/**
 * Which templates can a given WhatsApp number actually send?
 *
 * Sibling to check-routing.ts and check-threading.ts, and here for the same
 * reason: every way of getting this wrong is quiet, and the quiet lasts until a
 * customer doesn't get a message.
 *
 * Templates belong to a WhatsApp Business Account, not to a phone number. Every
 * number under one account can send all of its templates and none of another's.
 * Before this was modelled, a workspace with two accounts showed one merged
 * list — because the sync picked "the first inbox with a WABA id" from an
 * unordered query and only ever inserted, so it accumulated the union of both
 * accounts over time. It looked like a feature. Roughly half that list would
 * fail at Meta with 132001 "template name does not exist", after the message
 * had already been queued, depending on which number happened to be sending.
 *
 * The rules pinned down here:
 *
 *   1. A template is offered only for the account that holds it.
 *   2. An unclaimed template is offered everywhere, because we don't know whose
 *      it is and hiding it everywhere is worse than showing it once too often.
 *   3. A sync claims an unclaimed row rather than duplicating it — that is the
 *      backfill for everything stored before accounts were tracked.
 *   4. Two accounts may each hold their own "order_update" in English, and they
 *      are different templates that must both survive.
 *   5. A sync prunes what its own account no longer has, and touches nothing
 *      belonging to another account or to nobody.
 *   6. The default is per account. A workspace-wide one is a template the other
 *      account cannot send, chosen automatically, when a window has closed.
 *
 *     pnpm check:template-scope
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { TemplatesService } from "../apps/api/src/templates/templates.service";
import { templatesForWaba } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  → ${detail}` : ""}`);
}

const ORG = ORG_ID;
/** The two accounts: the older number's, and the new 0345 one's. */
const WABA_A = "waba_older";
const WABA_B = "waba_0345";

const tpl = (name: string, wabaId?: string, language = "en") => ({
  name,
  language,
  category: "utility" as const,
  body: `Hi {{1}}, this is ${name}.`,
  approvalStatus: "approved" as const,
  ...(wabaId ? { wabaId } : {}),
});

async function main(): Promise<void> {
  const store = new MemoryStore();
  // Start from a known set: the fixtures seed unclaimed templates, which is
  // exactly the pre-migration state this has to cope with.
  const seeded = await store.listTemplates(ORG);
  const seededNames = seeded.map((t) => t.name);

  console.log("\nWhat a sync does to templates stored before accounts existed\n");
  ok("the fixtures start unclaimed", seeded.every((t) => !t.wabaId), `${seeded.length} template(s)`);

  // Account A syncs and reports one of the pre-existing names.
  const claimedName = seededNames[0];
  await store.upsertTemplateByName(ORG, tpl(claimedName, WABA_A));
  let all = await store.listTemplates(ORG);
  const claimed = all.filter((t) => t.name === claimedName);
  ok("a sync claims the existing row rather than duplicating it", claimed.length === 1);
  ok("and the row now names its account", claimed[0]?.wabaId === WABA_A, claimed[0]?.wabaId);

  console.log("\nTwo accounts, one template name\n");
  await store.upsertTemplateByName(ORG, tpl("order_update", WABA_A));
  await store.upsertTemplateByName(ORG, tpl("order_update", WABA_B));
  all = await store.listTemplates(ORG);
  const orders = all.filter((t) => t.name === "order_update");
  ok("both survive as separate templates", orders.length === 2, `${orders.length} row(s)`);
  ok(
    "one per account",
    new Set(orders.map((t) => t.wabaId)).size === 2,
    orders.map((t) => t.wabaId).join(" + "),
  );

  // Re-syncing A must update A's copy, never reach across to B's.
  await store.upsertTemplateByName(ORG, { ...tpl("order_update", WABA_A), body: "Hi {{1}}, changed." });
  all = await store.listTemplates(ORG);
  const a = all.find((t) => t.name === "order_update" && t.wabaId === WABA_A);
  const b = all.find((t) => t.name === "order_update" && t.wabaId === WABA_B);
  ok("re-syncing one account updates its own copy", a?.body.includes("changed") === true);
  ok("and leaves the other account's alone", b?.body.includes("changed") === false, b?.body);

  console.log("\nWho gets offered what\n");
  const forA = templatesForWaba(all, WABA_A);
  const forB = templatesForWaba(all, WABA_B);
  ok("account A is not offered account B's template", !forA.some((t) => t.wabaId === WABA_B));
  ok("account B is not offered account A's template", !forB.some((t) => t.wabaId === WABA_A));
  ok("each is offered its own", forA.some((t) => t.wabaId === WABA_A) && forB.some((t) => t.wabaId === WABA_B));
  const unclaimed = all.filter((t) => !t.wabaId);
  ok(
    "an unclaimed template is offered to both",
    unclaimed.every((u) => forA.includes(u) && forB.includes(u)),
    `${unclaimed.length} unclaimed`,
  );
  // A channel with no account yet must not get an empty picker.
  ok("no account named → everything, not nothing", templatesForWaba(all, undefined).length === all.length);

  console.log("\nPruning what Meta no longer has\n");
  await store.upsertTemplateByName(ORG, tpl("seasonal_offer", WABA_A));
  const beforePrune = await store.listTemplates(ORG);
  // Account A's next sync sees everything except seasonal_offer.
  const keep = beforePrune
    .filter((t) => t.wabaId === WABA_A && t.name !== "seasonal_offer")
    .map((t) => ({ name: t.name, language: t.language }));
  const pruned = await store.pruneTemplatesForWaba(ORG, WABA_A, keep);
  const afterPrune = await store.listTemplates(ORG);
  ok("the withdrawn template goes", pruned === 1 && !afterPrune.some((t) => t.name === "seasonal_offer"));
  ok(
    "the other account's templates are untouched",
    afterPrune.some((t) => t.wabaId === WABA_B),
  );
  ok(
    "and so are the unclaimed ones",
    afterPrune.filter((t) => !t.wabaId).length === unclaimed.length,
    `${afterPrune.filter((t) => !t.wabaId).length} left of ${unclaimed.length}`,
  );

  console.log("\nLocale-qualified languages\n");
  // Meta answers "en_US" for a row we hold as "en". Treating that as a
  // different template would duplicate it; treating it as missing would delete
  // it. Neither is acceptable.
  await store.upsertTemplateByName(ORG, tpl("locale_check", WABA_B, "en"));
  await store.upsertTemplateByName(ORG, { ...tpl("locale_check", WABA_B, "en_US") });
  let localed = (await store.listTemplates(ORG)).filter((t) => t.name === "locale_check");
  ok("en_US updates the en row rather than duplicating", localed.length === 1, `${localed.length} row(s)`);
  ok("and adopts Meta's exact code", localed[0]?.language === "en_US", localed[0]?.language);
  const keepB = (await store.listTemplates(ORG))
    .filter((t) => t.wabaId === WABA_B)
    .map((t) => ({ name: t.name, language: "en" })); // Meta says "en", we hold "en_US"
  await store.pruneTemplatesForWaba(ORG, WABA_B, keepB);
  localed = (await store.listTemplates(ORG)).filter((t) => t.name === "locale_check");
  ok("a prune matching on the primary subtag keeps it", localed.length === 1);

  console.log("\nThe default template, per account\n");
  // The default is what the composer sends *by itself* once a 24-hour window
  // has closed. One workspace-wide default is guaranteed to be wrong for every
  // account but one — and it would be chosen automatically, at the moment an
  // agent is trying to get back to somebody.
  const svc = new TemplatesService(store);
  const listed = await svc.list();
  const aTpl = listed.find((t) => t.wabaId === WABA_A)!;
  const bTpl = listed.find((t) => t.wabaId === WABA_B)!;

  await svc.setDefault(aTpl.id);
  let now = await svc.list();
  ok("setting one account's default flags it", now.find((t) => t.id === aTpl.id)?.isDefault === true);
  ok(
    "and does not flag the other account's",
    now.find((t) => t.id === bTpl.id)?.isDefault === false,
  );

  await svc.setDefault(bTpl.id);
  now = await svc.list();
  ok("each account keeps its own default", now.find((t) => t.id === aTpl.id)?.isDefault === true);
  ok("both at once", now.find((t) => t.id === bTpl.id)?.isDefault === true);
  ok(
    "exactly one per account",
    now.filter((t) => t.isDefault && t.wabaId === WABA_A).length === 1 &&
      now.filter((t) => t.isDefault && t.wabaId === WABA_B).length === 1,
  );

  // Moving A's default to another of A's templates must not leave two.
  const aOther = now.find((t) => t.wabaId === WABA_A && t.id !== aTpl.id);
  if (aOther) {
    await svc.setDefault(aOther.id);
    now = await svc.list();
    ok(
      "moving an account's default replaces it rather than adding one",
      now.filter((t) => t.isDefault && t.wabaId === WABA_A).length === 1,
    );
    ok("and still doesn't disturb the other account", now.find((t) => t.id === bTpl.id)?.isDefault === true);
  }

  await svc.setDefault(null);
  now = await svc.list();
  ok("clearing clears every account", now.every((t) => !t.isDefault));

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
