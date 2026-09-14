/**
 * Which template re-opens a conversation, once its 24-hour window has closed.
 *
 * This one is chosen by nobody. The composer stays open, the agent types the
 * sentence they were going to type anyway, and it goes out as `{{1}}` of a
 * template the workspace picked weeks earlier. Everything about that is good
 * except what happens when the pick is wrong: it is wrong silently, in front of
 * a customer, at the moment somebody is trying to get back to them.
 *
 * The pick used to be keyed to the WhatsApp *account*. Numbers do not map to
 * accounts one-to-one — the ordinary arrangement is several numbers under one
 * WABA — so a workspace with a sales line and a support line had one setting
 * between them. Starring a template for one changed the other, which from the
 * outside is a setting that does not work.
 *
 * Templates genuinely do belong to the account: every number under a WABA can
 * send all of them and none of another's. That constraint is about what *may*
 * be sent. Which one re-opens a chat is a choice about what a line sounds like,
 * and the two are not the same question.
 *
 * So, three rules:
 *
 *   1. Two numbers on one account hold independent defaults.
 *   2. A number with no choice of its own inherits — its account's setting,
 *      then the pre-accounts workspace one. Nobody loses what they had.
 *   3. Clearing a number is a decision, not a gap: it sends nothing, rather
 *      than falling back into the account default it was just taken out of.
 *
 *     pnpm check:default-template
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { TemplatesService } from "../apps/api/src/templates/templates.service";
import { defaultTemplateFor } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const WABA_A = "waba_sales_support";
const WABA_B = "waba_other";

async function main(): Promise<void> {
  const store = new MemoryStore();
  const templates = new TemplatesService(store);

  // Two numbers under ONE account — the arrangement the old key could not
  // represent — plus a third under a second account.
  const sales = await store.createInbox({
    orgId: ORG_ID, type: "whatsapp", name: "Sales", handle: "+44 20 7946 0001",
    teamIds: [], routingStrategy: "manual",
    channelConfig: { wabaId: WABA_A, phoneNumberId: "pn_1", accessToken: "t" },
  });
  const support = await store.createInbox({
    orgId: ORG_ID, type: "whatsapp", name: "Support", handle: "+44 20 7946 0002",
    teamIds: [], routingStrategy: "manual",
    channelConfig: { wabaId: WABA_A, phoneNumberId: "pn_2", accessToken: "t" },
  });
  const other = await store.createInbox({
    orgId: ORG_ID, type: "whatsapp", name: "Other brand", handle: "+44 20 7946 0003",
    teamIds: [], routingStrategy: "manual",
    channelConfig: { wabaId: WABA_B, phoneNumberId: "pn_3", accessToken: "t" },
  });

  const mk = (name: string, body: string, wabaId?: string) =>
    store.upsertTemplateByName(ORG_ID, {
      name, body, language: "en", category: "utility", approvalStatus: "approved", wabaId,
    });
  // One variable each: that is the whole point — the agent's own text goes in it.
  const salesTpl = await mk("back_in_touch", "Quick one about your quote: {{1}}", WABA_A);
  const supportTpl = await mk("reopen_ticket", "About your ticket: {{1}}", WABA_A);
  const otherTpl = await mk("other_hello", "Hello again: {{1}}", WABA_B);

  console.log("\nTwo numbers on one account, two defaults\n");
  await templates.setChannelDefault(sales.id, salesTpl.id);
  await templates.setChannelDefault(support.id, supportTpl.id);
  let list = await templates.list();
  ok(
    "sales re-opens with its own template",
    defaultTemplateFor(list, sales.id)?.id === salesTpl.id,
    String(defaultTemplateFor(list, sales.id)?.name),
  );
  ok(
    "and support with its own — setting one did not move the other",
    defaultTemplateFor(list, support.id)?.id === supportTpl.id,
    String(defaultTemplateFor(list, support.id)?.name),
  );
  // The bug, reconstructed. Star sales' template account-wide as well — which
  // is all the old screen could do — and then pick the way the composer used
  // to: filter to this account, take the first flagged one. That answer cannot
  // vary by number, because nothing in it mentions the number.
  await templates.setDefault(salesTpl.id);
  list = await templates.list();
  const naive = (list.filter((t) => t.wabaId === WABA_A && t.isDefault && t.variableCount === 1))[0];
  ok(
    "the old account-wide pick gives support sales' sentence",
    naive?.id === salesTpl.id,
    `it would send “${naive?.name}” on both numbers`,
  );
  ok(
    "keying it to the number does not",
    defaultTemplateFor(list, support.id)?.id === supportTpl.id &&
      defaultTemplateFor(list, sales.id)?.id === salesTpl.id,
    String(defaultTemplateFor(list, support.id)?.name),
  );

  console.log("\nA number that has not chosen inherits\n");
  // `other` has no setting of its own; its account gets one via the star.
  await templates.setDefault(otherTpl.id);
  list = await templates.list();
  ok(
    "it falls back to its account's",
    defaultTemplateFor(list, other.id)?.id === otherTpl.id,
    String(defaultTemplateFor(list, other.id)?.name),
  );
  ok(
    "and the numbers that did choose are untouched by that",
    defaultTemplateFor(list, sales.id)?.id === salesTpl.id &&
      defaultTemplateFor(list, support.id)?.id === supportTpl.id,
  );

  console.log("\nClearing a number means none, not 'inherit again'\n");
  await templates.setChannelDefault(other.id, null);
  list = await templates.list();
  ok(
    "the number it was cleared on sends nothing",
    defaultTemplateFor(list, other.id) === null,
    String(defaultTemplateFor(list, other.id)?.name),
  );
  ok(
    "its account's setting still stands for anyone else",
    list.find((t) => t.id === otherTpl.id)?.isDefault === true,
  );

  console.log("\nThe legacy workspace-wide setting still reaches an unchosen number\n");
  const fresh = new MemoryStore();
  const svc = new TemplatesService(fresh);
  const legacyInbox = await fresh.createInbox({
    orgId: ORG_ID, type: "whatsapp", name: "Only number", handle: "+44 20 7946 0009",
    teamIds: [], routingStrategy: "manual",
    channelConfig: { wabaId: WABA_A, phoneNumberId: "pn_9", accessToken: "t" },
  });
  const legacyTpl = await fresh.upsertTemplateByName(ORG_ID, {
    name: "legacy_reopen", body: "Hi again — {{1}}", language: "en",
    category: "utility", approvalStatus: "approved",
  });
  // What a pre-accounts workspace has in the database: the bare key, and a
  // template no sync has claimed.
  await fresh.setAppSetting(ORG_ID, "wa_default_template_id", legacyTpl.id);
  const legacyList = await svc.list();
  ok(
    "a workspace that never touched this keeps what it had",
    defaultTemplateFor(legacyList, legacyInbox.id)?.id === legacyTpl.id,
    String(defaultTemplateFor(legacyList, legacyInbox.id)?.name),
  );

  console.log("\nWhat cannot be made a default\n");
  const twoVars = await fresh.upsertTemplateByName(ORG_ID, {
    name: "two_vars", body: "Hi {{1}}, about {{2}}", language: "en",
    category: "utility", approvalStatus: "approved", wabaId: WABA_A,
  });
  let rejected = false;
  try {
    await svc.setChannelDefault(legacyInbox.id, twoVars.id);
  } catch {
    rejected = true;
  }
  // Two variables leaves one of them blank in front of a customer, and there is
  // only ever one box of typed text to fill them from.
  ok("a template with two variables is refused", rejected);

  const foreign = await fresh.upsertTemplateByName(ORG_ID, {
    name: "foreign", body: "Hello: {{1}}", language: "en",
    category: "utility", approvalStatus: "approved", wabaId: WABA_B,
  });
  let refusedForeign = false;
  try {
    await svc.setChannelDefault(legacyInbox.id, foreign.id);
  } catch {
    refusedForeign = true;
  }
  // Meta would reject this at send time — automatically, with nobody watching.
  ok("so is another account's template", refusedForeign);

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
