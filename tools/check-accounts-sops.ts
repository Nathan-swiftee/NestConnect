/**
 * The Accounts team's SOPs (Business credit accounts, Receivables), added once
 * to the operator's own workspace.
 *
 *   A  With an Accounts team, both are published for it, in Finance, owned by
 *      David Miles, and the Accounts team can read them once the module is on.
 *   B  They say where the logins live and carry no password; nothing the
 *      sanitiser would strip was written.
 *   C  It runs once: a second start adds nothing, even after one is deleted.
 *   D  With no Accounts or Finance team they wait as drafts; an SOP already
 *      there by that title is left alone.
 *
 *     pnpm check:accounts-sops
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryOpsStore } from "../apps/api/src/ops/memory-ops.store";
import { OpsSeedService } from "../apps/api/src/ops/ops-seed.service";
import { OPS_MODULE_KEY, OpsService } from "../apps/api/src/ops/ops.service";
import { ACCOUNTS_SOPS, ACCOUNTS_SOPS_SEED_KEY } from "../apps/api/src/ops/seed/accounts-sops";
import { sanitizeKnowledgeHtml } from "../apps/api/src/accounts/knowledge-html";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const notifications = { create: async () => undefined } as unknown as NotificationsService;
const TITLES = ["Business credit accounts", "Receivables"];

async function main(): Promise<void> {
  console.log("\nA — added for the Accounts team\n");
  const store = new MemoryStore();
  const ops = new MemoryOpsStore();
  const seed = new OpsSeedService(ops, store);
  const service = new OpsService(ops, store, notifications);
  let accountsTeam = "";
  let clerk = "";
  let david = "";
  await runInTenant(ORG_ID, async () => {
    accountsTeam = (await store.createTeam({ orgId: ORG_ID, name: "Accounts" })).id;
    clerk = (await store.createUser({ orgId: ORG_ID, name: "Ava Clerk", email: "ava@swiftee.co.uk", role: "agent", teamIds: [accountsTeam] })).user.id;
    david = (await store.createUser({ orgId: ORG_ID, name: "David Miles", email: "david.miles@swiftee.co.uk", role: "manager", teamIds: [accountsTeam] })).user.id;
  });

  ok("it runs", (await seed.seedAccountsSops(ORG_ID)) === "added");
  await runInTenant(ORG_ID, async () => {
    const sops = (await ops.listSops()).filter((s) => TITLES.includes(s.title));
    ok("both SOPs are there", sops.length === 2, sops.map((s) => s.title).join(", "));
    ok("published, version 1", sops.every((s) => s.status === "published" && s.version === 1));
    ok("for the Accounts team only", sops.every((s) => !s.allTeams && s.teamIds.length === 1 && s.teamIds[0] === accountsTeam));
    ok("owned by David Miles", sops.every((s) => s.owner?.id === david), JSON.stringify(sops.map((s) => s.owner)));
    const finance = await ops.collectionByName("Finance");
    ok("in the Finance collection", !!finance && sops.every((s) => s.collectionId === finance.id));
    ok("each with its first version kept", (await Promise.all(sops.map((s) => ops.listRevisions(s.id)))).every((r) => r.length === 1));
    ok("reviewed yearly", sops.every((s) => s.reviewEveryMonths === 12 && !!s.reviewDueAt));
    const receivables = sops.find((s) => s.title === "Receivables")!;
    ok("Receivables has the 13 dated steps, 1st to 28th", receivables.steps.length === 13 && /^1st/.test(receivables.steps[0]!.text) && /^28th/.test(receivables.steps[12]!.text));

    await store.setAppSetting(ORG_ID, OPS_MODULE_KEY, "on");
    const lib = await service.library(clerk);
    const seen = lib.sops.map((s) => s.title);
    ok("someone in Accounts can read them", TITLES.every((t) => seen.includes(t)), seen.join(", "));

    console.log("\nB — no passwords, nothing stripped\n");
    const text = JSON.stringify(sops);
    ok("no password anywhere", !/password\s*:/i.test(text) && !/SwifteeAccounts|Andromida/i.test(text));
    ok("they say where the logins are", /password manager/.test(text));
    for (const sop of ACCOUNTS_SOPS) {
      const tags = (html: string) => (html.match(/<\/?[a-z0-9]+/gi) ?? []).join("");
      const kept = sanitizeKnowledgeHtml(sop.body ?? "");
      ok(`“${sop.title}” is written in what the editor keeps`, tags(kept) === tags(sop.body ?? "") && kept.length > 1000);
    }

    console.log("\nC — once\n");
    await ops.removeSop(receivables.id);
  });
  ok("a second start knows it's done", (await seed.seedAccountsSops(ORG_ID)) === "done-before");
  await runInTenant(ORG_ID, async () => {
    ok("…and doesn't bring back one that was deleted", !(await ops.listSops()).some((s) => s.title === "Receivables"));
    ok("it remembered", !!(await store.getAppSetting(ORG_ID, ACCOUNTS_SOPS_SEED_KEY)));
  });

  console.log("\nD — no Accounts team yet; one already written\n");
  const store2 = new MemoryStore();
  const ops2 = new MemoryOpsStore();
  await runInTenant(ORG_ID, async () => {
    const service2 = new OpsService(ops2, store2, notifications);
    await store2.setAppSetting(ORG_ID, OPS_MODULE_KEY, "on");
    await service2.create(DEMO_USER_ID, { title: "Receivables", steps: [{ text: "Our own" }], teamIds: [], allTeams: true });
  });
  ok("it runs", (await new OpsSeedService(ops2, store2).seedAccountsSops(ORG_ID)) === "added");
  await runInTenant(ORG_ID, async () => {
    const sops = await ops2.listSops();
    const credit = sops.filter((s) => s.title === "Business credit accounts");
    ok("the other waits as a draft, for nobody yet", credit.length === 1 && credit[0]!.status === "draft" && !credit[0]!.teamIds.length && !credit[0]!.allTeams);
    const own = sops.filter((s) => s.title === "Receivables");
    ok("the one already there is left as it was", own.length === 1 && own[0]!.steps[0]?.text === "Our own");
    ok("with no David, whoever added them owns them", credit[0]!.owner?.id === DEMO_USER_ID);
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
