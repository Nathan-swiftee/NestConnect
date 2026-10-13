/**
 * Business Ops — the workspace's own SOPs, against the in-memory stores.
 *
 *   A  the module is off until an admin switches it on; off, nothing answers;
 *   B  admins and managers write SOPs; agents can't;
 *   C  a reader sees published SOPs for their teams (or All teams), never a
 *      draft, an archived one or another team's;
 *   D  publishing keeps each version, with what changed;
 *   E  a must-read asks its readers to confirm, and again for a new version;
 *   F  checklists are per person and can be reset;
 *   G  review dates come due and the owner is told once;
 *   H  search, collections, paste-to-steps; another workspace sees none of it.
 *
 *     pnpm check:business-ops
 */
import { OpsService } from "../apps/api/src/ops/ops.service";
import { MemoryOpsStore } from "../apps/api/src/ops/memory-ops.store";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import {
  describeOpsChanges,
  nextReviewDue,
  opsSopInputSchema,
  splitIntoSteps,
  updateOpsSopInputSchema,
  type OpsSopInput,
} from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function refuses(p: Promise<unknown>, status: number): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (err) {
    return (err as { getStatus?: () => number }).getStatus?.() === status;
  }
}
/** What the controller's validation pipe hands the service. */
const parsed = (input: OpsSopInput) => opsSopInputSchema.parse(input);
const patch = (input: Parameters<typeof updateOpsSopInputSchema.parse>[0]) => updateOpsSopInputSchema.parse(input);
const titles = (list: { title: string }[]) =>
  list
    .map((s) => s.title)
    .sort()
    .join(", ");

const ADMIN = DEMO_USER_ID; // admin, both teams
const JAMES = "usr_james"; // agent, Support team
const AMARA = "usr_amara"; // agent, Sales team

async function main() {
  const store = new MemoryStore();
  const sent: Array<{ userId: string; type: string; title: string; opsSopId?: string | null }> = [];
  const notifications = {
    create: async (userId: string, n: { type: string; title: string; opsSopId?: string | null }) => {
      sent.push({ userId, type: n.type, title: n.title, opsSopId: n.opsSopId });
    },
  } as unknown as NotificationsService;
  const svc = new OpsService(new MemoryOpsStore(), store, notifications);

  await runInTenant(ORG_ID, async () => {
    console.log("\nA — the switch\n");
    ok("off to begin with", (await svc.status(ADMIN)).enabled === false);
    ok("off, the library is a 404", await refuses(svc.library(ADMIN), 404));
    ok("off, nothing can be written", await refuses(svc.create(ADMIN, parsed({ title: "x" })), 404));
    ok("an agent can't switch it on", await refuses(svc.setEnabled(JAMES, true), 403));
    const on = await svc.setEnabled(ADMIN, true);
    ok("an admin can", on.enabled && on.canEdit);
    ok("an agent learns it's on, and that they read only", (await svc.status(JAMES)).enabled && !(await svc.status(JAMES)).canEdit);

    console.log("\nB — who writes them\n");
    ok("an agent can't create an SOP", await refuses(svc.create(JAMES, parsed({ title: "Mine" })), 403));
    const opening = await svc.create(
      ADMIN,
      parsed({
        title: "Opening the warehouse",
        icon: "🏭",
        summary: "First in, every morning.",
        warnings: "Never open the shutter alone.",
        steps: [{ text: "Disarm the alarm" }, { text: "Lights on", link: "https://example.com/panel" }, { text: "Open the shutter" }],
        body: "<p>Keys are in the <strong>blue</strong> box.</p><script>alert(1)</script>",
        teamIds: ["team_support"],
        mustRead: true,
        reviewEveryMonths: 6,
      }),
    );
    ok("an admin creates a draft", opening.status === "draft" && opening.version === 0);
    ok("its owner is whoever made it", opening.owner?.id === ADMIN);
    ok("details are cleaned", !opening.body.includes("<script") && opening.body.includes("<strong>blue</strong>"), opening.body);
    ok("a step keeps its link", opening.steps[1]?.link === "https://example.com/panel");
    ok("no review date until it's published", opening.reviewDueAt === null);
    ok("a team from nowhere is refused", await refuses(svc.create(ADMIN, parsed({ title: "x", teamIds: ["team_nope"] })), 400));
    ok(
      "a step picture must be uploaded or https",
      !opsSopInputSchema.safeParse({ title: "x", steps: [{ text: "a", imageUrl: "javascript:alert(1)" }] }).success,
    );

    await store.updateUser(AMARA, { role: "manager" });
    const refunds = await svc.create(
      AMARA,
      parsed({ title: "Issuing a refund", steps: [{ text: "Check the order" }, { text: "Refund in Stripe" }], allTeams: true }),
    );
    ok("so can a manager", refunds.updatedBy?.id === AMARA);
    await store.updateUser(AMARA, { role: "agent" });
    const pricing = await svc.create(ADMIN, parsed({ title: "Quoting a price", steps: [{ text: "Use the price list" }], teamIds: ["team_sales"] }));

    console.log("\nC — who reads them\n");
    ok("a draft is only for editors", titles((await svc.library(JAMES)).sops) === "");
    ok("an agent can't open a draft — it's a 404, not a 403", await refuses(svc.get(JAMES, opening.id), 404));
    ok("an editor sees drafts", titles((await svc.library(ADMIN)).sops) === "Issuing a refund, Opening the warehouse, Quoting a price");
    ok(
      "publishing needs teams",
      await refuses(svc.publish(ADMIN, (await svc.create(ADMIN, parsed({ title: "No teams", steps: [{ text: "a" }] }))).id, {}), 400),
    );
    ok("and something to read", await refuses(svc.publish(ADMIN, (await svc.create(ADMIN, parsed({ title: "Empty", allTeams: true }))).id, {}), 400));

    sent.length = 0;
    const v1 = await svc.publish(ADMIN, opening.id, { note: "" });
    await svc.publish(ADMIN, refunds.id, { note: "" });
    await svc.publish(ADMIN, pricing.id, { note: "" });
    ok("published is version 1", v1.status === "published" && v1.version === 1);
    ok("James (Support) reads Support's and All teams'", titles((await svc.library(JAMES)).sops) === "Issuing a refund, Opening the warehouse");
    ok("Amara (Sales) reads Sales' and All teams'", titles((await svc.library(AMARA)).sops) === "Issuing a refund, Quoting a price");
    ok("another team's SOP is a 404", await refuses(svc.get(AMARA, opening.id), 404));
    ok("an agent can't edit a published one", await refuses(svc.update(JAMES, opening.id, patch({ title: "x" })), 403));
    await svc.archive(ADMIN, pricing.id);
    ok("archived leaves the library", !(await svc.library(AMARA)).sops.some((s) => s.id === pricing.id));
    ok("an editor still has it", (await svc.library(ADMIN)).sops.find((s) => s.id === pricing.id)?.status === "archived");
    ok("restored, it's back as it was", (await svc.restore(ADMIN, pricing.id)).status === "published");

    console.log("\nD — versions\n");
    const fixed = await svc.update(ADMIN, opening.id, patch({ summary: "First in, every weekday morning." }));
    ok("a save on a published SOP is live, same version", fixed.version === 1 && (await svc.get(JAMES, opening.id)).summary.includes("weekday"));
    await svc.update(
      ADMIN,
      opening.id,
      patch({ steps: [{ text: "Disarm the alarm" }, { text: "Lights on" }, { text: "Open the shutter" }, { text: "Sign the log" }] }),
    );
    const v2 = await svc.publish(ADMIN, opening.id, { note: "Added the log" });
    ok("publishing again is version 2", v2.version === 2);
    const versions = await svc.versions(JAMES, opening.id);
    ok("both versions are kept, newest first", versions.map((v) => v.version).join() === "2,1");
    ok("with who published and why", versions[0]?.publishedBy?.name === "Nathan A" && versions[0]?.note === "Added the log");
    const changes = describeOpsChanges(versions[1]!, versions[0]!);
    ok("what changed, in words", changes.join("; ") === "Summary edited; 1 step added; Step pictures or links changed", changes.join("; "));
    ok("the first one says so", describeOpsChanges(null, versions[1]!).join() === "First published");

    console.log("\nE — must-read\n");
    const firstRound = sent.filter((n) => n.type === "ops_must_read" && n.opsSopId === opening.id);
    ok("v1 asked Support to read it, not the publisher", firstRound.some((n) => n.userId === JAMES) && !firstRound.some((n) => n.userId === ADMIN));
    ok("and nobody outside the team", !firstRound.some((n) => n.userId === AMARA));
    ok("not for an SOP that isn't a must-read", !sent.some((n) => n.opsSopId === refunds.id));
    ok("James has one waiting", (await svc.status(JAMES)).pendingAcks === 1);
    ok("the card says so", (await svc.library(JAMES)).sops.find((s) => s.id === opening.id)?.needsMyAck === true);
    const acked = await svc.acknowledge(JAMES, opening.id);
    ok("“I've read this” confirms the current version", acked.myAck?.version === 2 && !acked.needsMyAck);
    ok("nothing waiting now", (await svc.status(JAMES)).pendingAcks === 0);
    const report = await svc.ackReport(ADMIN, opening.id);
    ok(
      "editors see who has and hasn't",
      report.people.map((p) => `${p.name}:${p.ackedVersion ?? "-"}`).join() === "James:2,Nathan A:-",
      report.people.map((p) => `${p.name}:${p.ackedVersion ?? "-"}`).join(),
    );
    ok("an agent can't see the report", await refuses(svc.ackReport(JAMES, opening.id), 403));
    ok("someone outside its teams can't confirm it", await refuses(svc.acknowledge(AMARA, opening.id), 404));
    await svc.update(ADMIN, opening.id, patch({ warnings: "Never open the shutter alone. Wear gloves." }));
    await svc.publish(ADMIN, opening.id, {});
    ok("a new version asks again", (await svc.status(JAMES)).pendingAcks === 1);
    ok(
      "and says it's an update",
      sent.some((n) => n.userId === JAMES && n.title === "Updated must-read: Opening the warehouse"),
    );

    console.log("\nF — checklists\n");
    const ticked = await svc.setChecklist(JAMES, opening.id, [2, 0, 0]);
    ok("ticks are saved once each, in order", ticked.join() === "0,2");
    ok("they're mine", (await svc.get(JAMES, opening.id)).myChecklist.join() === "0,2" && (await svc.get(ADMIN, opening.id)).myChecklist.length === 0);
    ok("a step that doesn't exist can't be ticked", await refuses(svc.setChecklist(JAMES, opening.id, [9]), 400));
    ok("reset clears them", (await svc.setChecklist(JAMES, opening.id, [])).length === 0);

    console.log("\nG — reviews\n");
    const now = await svc.get(ADMIN, opening.id);
    const expected = nextReviewDue(now.lastReviewedAt!, 6);
    ok("published with a 6-month period, due 6 months on", now.reviewDueAt === expected, `${now.reviewDueAt} vs ${expected}`);
    ok("not overdue yet", !now.reviewOverdue);
    sent.length = 0;
    const later = new Date(Date.now() + 200 * 86_400_000);
    ok("the sweep tells the owner when it's due", (await svc.sweepReviews(later)) === 1);
    ok("as a review reminder for the SOP", sent[0]?.userId === ADMIN && sent[0]?.type === "ops_review" && sent[0]?.opsSopId === opening.id);
    ok("once", (await svc.sweepReviews(later)) === 0);
    const reviewed = await svc.markReviewed(ADMIN, opening.id);
    ok("“still right” starts the clock again", reviewed.reviewDueAt! > now.reviewDueAt!);
    const none = await svc.update(ADMIN, opening.id, patch({ reviewEveryMonths: null }));
    ok("no period, no due date", none.reviewDueAt === null);
    const back = await svc.update(ADMIN, opening.id, patch({ reviewEveryMonths: 12 }));
    ok("a period set later counts from the last review", back.reviewDueAt === nextReviewDue(back.lastReviewedAt!, 12));
    await svc.update(ADMIN, opening.id, patch({ ownerUserId: JAMES }));
    ok("the owner can be changed", (await svc.get(ADMIN, opening.id)).owner?.name === "James");
    ok("but not to a stranger", await refuses(svc.update(ADMIN, opening.id, patch({ ownerUserId: "usr_nobody" })), 400));

    console.log("\nH — finding things\n");
    ok("search finds a step's words", titles((await svc.library(JAMES, "sign log")).sops) === "Opening the warehouse");
    ok("and the details' words", titles((await svc.library(JAMES, "blue box")).sops) === "Opening the warehouse");
    ok("not another team's", (await svc.library(AMARA, "shutter")).sops.length === 0);
    const daily = await svc.createCollection(ADMIN, { name: "Daily", icon: "☀️" });
    ok("collections have a name, icon and colour", daily.name === "Daily" && daily.icon === "☀️" && daily.color === "#0FA47A");
    ok("names are unique", await refuses(svc.createCollection(ADMIN, { name: "daily" }), 409));
    ok("an agent can't make one", await refuses(svc.createCollection(JAMES, { name: "Mine" }), 403));
    await svc.update(ADMIN, opening.id, patch({ collectionId: daily.id }));
    ok("an SOP files under one", (await svc.library(JAMES)).collections.find((c) => c.id === daily.id)?.sopCount === 1);
    ok("counted for what each person can see", (await svc.library(AMARA)).collections.find((c) => c.id === daily.id)?.sopCount === 0);
    ok("a collection from nowhere is refused", await refuses(svc.update(ADMIN, opening.id, patch({ collectionId: "opc_nope" })), 400));
    await svc.removeCollection(ADMIN, daily.id);
    ok("deleting a collection keeps its SOPs", (await svc.get(ADMIN, opening.id)).collectionId === null);
    const steps = splitIntoSteps("1. Disarm the alarm\n2) Lights on\n\n- Open the shutter\n• Sign the log\nStep 5: Coffee\n[x] Done");
    ok("pasted text becomes steps", steps.join(" | ") === "Disarm the alarm | Lights on | Open the shutter | Sign the log | Coffee | Done", steps.join(" | "));
    await svc.remove(ADMIN, pricing.id);
    ok("a deleted SOP is gone", await refuses(svc.get(ADMIN, pricing.id), 404));

    await svc.setEnabled(ADMIN, false);
    ok("switched off, it's hidden again", await refuses(svc.library(JAMES), 404));
    await svc.setEnabled(ADMIN, true);
    ok("and on, everything's still there", (await svc.library(ADMIN)).sops.some((s) => s.id === opening.id));
  });

  console.log("\nother workspace\n");
  await runInTenant("org_elsewhere", async () => {
    ok("the switch is per workspace", (await svc.status(ADMIN).catch(() => ({ enabled: false }))).enabled === false);
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall business ops checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
