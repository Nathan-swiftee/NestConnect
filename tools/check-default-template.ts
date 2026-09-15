/**
 * The star in Settings › Templates, and what it is allowed to touch.
 *
 * Starring a template makes it the one the composer sends *by itself* once a
 * 24-hour window has closed: the agent keeps typing normally and what they
 * write becomes its `{{1}}`. Nobody picks it at the moment it goes out, so a
 * wrong one is wrong silently, in front of a customer.
 *
 * It is scoped to the WhatsApp account rather than to the number. That is
 * deliberate and it is a trade: templates belong to a WABA, one control is
 * easier to hold in your head than two, and the cost is that two numbers under
 * one account re-open a chat with the same sentence. What is *not* acceptable
 * is one account's star moving another account's.
 *
 * Unstarring used to do exactly that. The screen sent `null` — "no default",
 * with nothing in it saying whose — and the only thing the server could make of
 * that was to clear every account's key. So a workspace with two accounts, each
 * with its own starred template, lost both the moment anybody unstarred either
 * one. Both directions now carry the template id, so both know whose account
 * they are for.
 *
 * Three rules:
 *
 *   1. Two accounts hold independent defaults.
 *   2. Unstarring one leaves the other alone.
 *   3. A workspace that set a default before templates were scoped keeps it.
 *
 *     pnpm check:default-template
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { TemplatesService } from "../apps/api/src/templates/templates.service";
import { setDefaultTemplateInputSchema } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const WABA_A = "waba_swiftee";
const WABA_B = "waba_other_brand";

/** The template this number would re-open a closed chat with, as the composer
 *  resolves it: this account's templates, then the starred one. */
function forAccount(templates: Array<{ wabaId?: string; isDefault: boolean; variableCount: number; id: string }>, wabaId: string) {
  return templates.find((t) => (!t.wabaId || t.wabaId === wabaId) && t.isDefault && t.variableCount === 1) ?? null;
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const templates = new TemplatesService(store);

  const mk = (name: string, body: string, wabaId?: string) =>
    store.upsertTemplateByName(ORG_ID, {
      name, body, language: "en", category: "utility", approvalStatus: "approved", wabaId,
    });
  // One variable each: that is the whole point — the agent's own text goes in it.
  const ours = await mk("back_in_touch", "Quick one about your quote: {{1}}", WABA_A);
  const theirs = await mk("other_hello", "Hello again: {{1}}", WABA_B);

  console.log("\nTwo accounts, two stars\n");
  await templates.setDefault(ours.id, true);
  await templates.setDefault(theirs.id, true);
  let list = await templates.list();
  ok("each account re-opens with its own", forAccount(list, WABA_A)?.id === ours.id, String(forAccount(list, WABA_A)?.name));
  ok("and the other with its own", forAccount(list, WABA_B)?.id === theirs.id, String(forAccount(list, WABA_B)?.name));

  console.log("\nUnstarring one leaves the other standing\n");
  await templates.setDefault(ours.id, false);
  list = await templates.list();
  ok("the one unstarred is gone", forAccount(list, WABA_A) === null, String(forAccount(list, WABA_A)?.name));
  // The bug this exists for: a bare "clear the default" named no account, so it
  // cleared them all, and the untouched account silently lost its template too.
  ok(
    "the untouched account keeps its default",
    forAccount(list, WABA_B)?.id === theirs.id,
    String(forAccount(list, WABA_B)?.name),
  );

  console.log("\nThe pre-accounts workspace setting still holds\n");
  const fresh = new MemoryStore();
  const svc = new TemplatesService(fresh);
  // What a workspace that predates template scoping has: the bare key, and a
  // template no sync has claimed for an account.
  const legacyTpl = await fresh.upsertTemplateByName(ORG_ID, {
    name: "legacy_reopen", body: "Hi again — {{1}}", language: "en",
    category: "utility", approvalStatus: "approved",
  });
  await fresh.setAppSetting(ORG_ID, "wa_default_template_id", legacyTpl.id);
  let legacyList = await svc.list();
  ok(
    "an account with no star of its own still falls back to it",
    forAccount(legacyList, WABA_A)?.id === legacyTpl.id,
    String(forAccount(legacyList, WABA_A)?.name),
  );
  // An unclaimed template answers to that same bare key, so unstarring it has
  // to clear it there as well — otherwise the star goes dark and the template
  // keeps being sent.
  await svc.setDefault(legacyTpl.id, false);
  legacyList = await svc.list();
  ok(
    "unstarring an unclaimed template really stops it",
    forAccount(legacyList, WABA_A) === null,
    String(forAccount(legacyList, WABA_A)?.name),
  );

  console.log("\nA screen somebody still has open\n");
  // The request shape changed under a deployed app. A browser tab opened before
  // the deploy keeps its old JavaScript and goes on sending the old payload —
  // and rejecting that is not a validation success, it is every star on that
  // tab silently failing. Both shapes have to work.
  const old = new MemoryStore();
  const oldSvc = new TemplatesService(old);
  const t1 = await old.upsertTemplateByName(ORG_ID, {
    name: "one", body: "Hi: {{1}}", language: "en", category: "utility",
    approvalStatus: "approved", wabaId: WABA_A,
  });
  const t2 = await old.upsertTemplateByName(ORG_ID, {
    name: "two", body: "Hello: {{1}}", language: "en", category: "utility",
    approvalStatus: "approved", wabaId: WABA_B,
  });
  // The old client sent the id alone, and it always meant "star this".
  await oldSvc.setDefault(t1.id);
  let oldList = await oldSvc.list();
  ok("an id with no flag still stars it", oldList.find((t) => t.id === t1.id)?.isDefault === true);
  // The new client says which way it meant.
  await oldSvc.setDefault(t2.id, true);
  oldList = await oldSvc.list();
  ok(
    "and the new shape works alongside it",
    oldList.find((t) => t.id === t2.id)?.isDefault === true &&
      oldList.find((t) => t.id === t1.id)?.isDefault === true,
  );
  // The old client sent a bare null to unstar, naming no account. Clearing
  // everything is all that can be made of it, and it is what it used to do.
  await oldSvc.setDefault(null);
  oldList = await oldSvc.list();
  ok("a bare null still clears, rather than being refused", oldList.every((t) => !t.isDefault));

  const validated = setDefaultTemplateInputSchema.safeParse({ templateId: t1.id });
  ok("and the old payload passes validation", validated.success);
  const validatedNull = setDefaultTemplateInputSchema.safeParse({ templateId: null });
  ok("as does the old unstar payload", validatedNull.success);

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
