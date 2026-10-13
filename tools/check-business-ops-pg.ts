/**
 * Business Ops on real Postgres: the tenant-scoped store, and one workspace's
 * SOPs staying its own.
 *
 * Two workspaces each switch the module on and publish an SOP for their own
 * team. Acting as the second, the first's SOP, collection, versions and read
 * confirmations can't be listed, read, changed or linked to. Then the store's
 * own behaviour: teams replaced on save, a deleted collection leaving its SOPs,
 * confirmations and checklists kept per person, cascades on delete, and the
 * review sweep reaching across workspaces only to act inside each.
 *
 *     DATABASE_URL=… pnpm check:business-ops-pg
 */
import { PrismaClient } from "@prisma/client";
import { OpsService } from "../apps/api/src/ops/ops.service";
import { PrismaOpsStore } from "../apps/api/src/ops/prisma-ops.store";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { opsSopInputSchema, updateOpsSopInputSchema } from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function refuses(p: () => Promise<unknown>): Promise<boolean> {
  try {
    await p();
    return false;
  } catch {
    return true;
  }
}
const violation = (p: Promise<unknown>) =>
  p.then(
    () => false,
    (e: Error) => e.name === "TenantViolationError",
  );

const A = "opschk_a";
const B = "opschk_b";

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [A, B];
  await root.notification.deleteMany({ where: { user: { orgId: { in: orgs } } } });
  await root.opsSop.deleteMany({ where: { orgId: { in: orgs } } }); // teams, versions, acks, checklists cascade
  await root.opsCollection.deleteMany({ where: { orgId: { in: orgs } } });
  await root.teamMember.deleteMany({ where: { team: { orgId: { in: orgs } } } });
  await root.team.deleteMany({ where: { orgId: { in: orgs } } });
  await root.session.deleteMany({ where: { user: { orgId: { in: orgs } } } });
  await root.user.deleteMany({ where: { orgId: { in: orgs } } });
  await root.appSetting.deleteMany({ where: { orgId: { in: orgs } } });
  await root.organization.deleteMany({ where: { id: { in: orgs } } });
}

async function main(): Promise<void> {
  const root = new PrismaClient();
  const store = new PrismaStore(root as unknown as PrismaService, new SecretEncryptionService());
  const ops = new PrismaOpsStore(root as unknown as PrismaService);
  const told: Array<{ userId: string; type: string; opsSopId?: string | null }> = [];
  // The real bell row, minus the socket and the phone.
  const notifications = {
    create: async (userId: string, n: { type: "ops_review" | "ops_must_read"; title: string; body?: string; opsSopId?: string | null }) => {
      told.push({ userId, type: n.type, opsSopId: n.opsSopId });
      await store.createNotification({ userId, type: n.type, title: n.title, body: n.body, opsSopId: n.opsSopId });
    },
  } as unknown as NotificationsService;
  const svc = new OpsService(ops, store, notifications);
  await cleanup(root);
  for (const id of [A, B]) await root.organization.create({ data: { id, name: id } });

  const build = (org: string, tag: string) =>
    runInTenant(org, async () => {
      const team = await store.createTeam({ orgId: org, name: `${tag} support` });
      const other = await store.createTeam({ orgId: org, name: `${tag} sales` });
      const { user: admin } = await store.createUser({
        orgId: org, name: `${tag} admin`, email: `opschk-${tag}@example.com`, role: "admin", teamIds: [team.id], password: "x-password-1",
      });
      const { user: agent } = await store.createUser({
        orgId: org, name: `${tag} agent`, email: `opschk-${tag}-agent@example.com`, role: "agent", teamIds: [team.id], password: "x-password-1",
      });
      await svc.setEnabled(admin.id, true);
      const collection = await svc.createCollection(admin.id, { name: "Daily" });
      const sop = await svc.create(
        admin.id,
        opsSopInputSchema.parse({
          title: `${tag} opening`,
          steps: [{ text: `${tag} secret step` }, { text: "Lights on" }],
          teamIds: [team.id],
          collectionId: collection.id,
          mustRead: true,
          reviewEveryMonths: 1,
        }),
      );
      await svc.publish(admin.id, sop.id, { note: "first" });
      return { team, other, admin, agent, collection, sop };
    });

  try {
    const a = await build(A, "a");
    const b = await build(B, "b");

    console.log("\nOne workspace's SOPs are its own\n");
    ok("both can name a collection the same", a.collection.name === b.collection.name);
    await runInTenant(B, async () => {
      const lib = await svc.library(b.admin.id);
      ok("B's library is only B's", lib.sops.map((s) => s.id).join() === b.sop.id && lib.collections.map((c) => c.id).join() === b.collection.id);
      ok("searching for A's words finds nothing", (await svc.library(b.admin.id, "a secret")).sops.length === 0);
      ok("A's SOP can't be opened by id", await refuses(() => svc.get(b.admin.id, a.sop.id)));
      ok("or its versions read", await refuses(() => svc.versions(b.admin.id, a.sop.id)));
      ok("or its read report", await refuses(() => svc.ackReport(b.admin.id, a.sop.id)));
      ok("or changed", await refuses(() => svc.update(b.admin.id, a.sop.id, updateOpsSopInputSchema.parse({ title: "hijacked" }))));
      ok("or published", await refuses(() => svc.publish(b.admin.id, a.sop.id, {})));
      ok("or confirmed", await refuses(() => svc.acknowledge(b.admin.id, a.sop.id)));
      ok("or ticked", await refuses(() => svc.setChecklist(b.admin.id, a.sop.id, [0])));
      ok("or deleted", await refuses(() => svc.remove(b.admin.id, a.sop.id)));
      ok("A's collection can't be renamed", await refuses(() => svc.updateCollection(b.admin.id, a.collection.id, { name: "x" })));
      ok("A's collection can't be used", await refuses(() => svc.update(b.admin.id, b.sop.id, updateOpsSopInputSchema.parse({ collectionId: a.collection.id }))));
      ok("A's team can't be given B's SOP", await refuses(() => svc.update(b.admin.id, b.sop.id, updateOpsSopInputSchema.parse({ teamIds: [a.team.id] }))));
      ok("A's person can't own it", await refuses(() => svc.update(b.admin.id, b.sop.id, updateOpsSopInputSchema.parse({ ownerUserId: a.admin.id }))));
      ok("not even through the store: a team", await violation(ops.updateSop(b.sop.id, { teamIds: [a.team.id] })));
      ok("a collection", await violation(ops.updateSop(b.sop.id, { collectionId: a.collection.id })));
      ok("a version", await violation(ops.addRevision(a.sop.id, { version: 9, title: "x", summary: "", warnings: "", steps: [], body: "", note: "", publishedAt: new Date().toISOString(), publishedBy: null })));
      ok("a confirmation", await violation(ops.setAck(a.sop.id, b.admin.id, 1)));
      ok("a checklist", await violation(ops.setChecklist(a.sop.id, b.admin.id, [0])));
      ok("A's confirmations aren't B's to list", (await ops.acksForSop(a.sop.id)).length === 0);
      ok("switching B off", (await svc.setEnabled(b.admin.id, false)).enabled === false);
    });
    await runInTenant(A, async () => {
      ok("leaves A on", (await svc.status(a.admin.id)).enabled);
      const mine = await svc.get(a.admin.id, a.sop.id);
      ok("A's SOP is untouched", mine.title === "a opening" && mine.version === 1 && mine.teamIds.join() === a.team.id);
    });
    await runInTenant(B, () => svc.setEnabled(b.admin.id, true));

    console.log("\nThe store\n");
    await runInTenant(A, async () => {
      ok("a must-read told its team's agent, in the bell", told.some((t) => t.userId === a.agent.id && t.type === "ops_must_read"));
      const bell = await store.listNotifications(a.agent.id);
      ok("the bell row opens the SOP", bell[0]?.opsSopId === a.sop.id && bell[0]?.type === "ops_must_read");
      ok("the agent reads it", (await svc.library(a.agent.id)).sops.map((s) => s.id).join() === a.sop.id);
      const acked = await svc.acknowledge(a.agent.id, a.sop.id);
      ok("and confirms it", acked.myAck?.version === 1);
      const again = await svc.acknowledge(a.agent.id, a.sop.id);
      ok("confirming twice keeps one", again.myAck?.version === 1 && (await root.opsAck.count({ where: { opsSopId: a.sop.id } })) === 1);
      await svc.setChecklist(a.agent.id, a.sop.id, [1, 0, 1]);
      ok("a checklist round-trips", (await svc.get(a.agent.id, a.sop.id)).myChecklist.join() === "0,1");
      ok("and is the agent's alone", (await svc.get(a.admin.id, a.sop.id)).myChecklist.length === 0);
      const moved = await svc.update(a.admin.id, a.sop.id, updateOpsSopInputSchema.parse({ teamIds: [a.other.id, a.team.id] }));
      ok("saving replaces its teams", moved.teamIds.length === 2);
      const v2 = await svc.publish(a.admin.id, a.sop.id, { note: "second" });
      ok("versions are kept", (await svc.versions(a.agent.id, a.sop.id)).map((v) => `${v.version}:${v.note}`).join() === "2:second,1:first" && v2.version === 2);
      ok("and the agent is asked again", (await svc.status(a.agent.id)).pendingAcks === 1);
      await store.deleteTeam(a.other.id);
      ok("deleting a team drops it from the SOP", (await svc.get(a.admin.id, a.sop.id)).teamIds.join() === a.team.id);
      await svc.removeCollection(a.admin.id, a.collection.id);
      ok("deleting a collection leaves its SOPs", (await svc.get(a.admin.id, a.sop.id)).collectionId === null);
      const before = (await svc.get(a.admin.id, a.sop.id)).updatedAt;

      told.length = 0;
      const later = new Date(Date.now() + 40 * 86_400_000);
      // The sweep spans workspaces but each SOP is handled in its own.
      const sent = await svc.sweepReviews(later);
      ok("the review sweep tells both owners, each in their own workspace", sent === 2 && told.every((t) => t.type === "ops_review"), String(sent));
      ok("A's owner about A's SOP", told.some((t) => t.userId === a.admin.id && t.opsSopId === a.sop.id));
      ok("once", (await svc.sweepReviews(later)) === 0);
      ok("a reminder doesn't count as an edit", (await svc.get(a.admin.id, a.sop.id)).updatedAt === before);

      await svc.remove(a.admin.id, a.sop.id);
      const left = await Promise.all([
        root.opsSopRevision.count({ where: { opsSopId: a.sop.id } }),
        root.opsAck.count({ where: { opsSopId: a.sop.id } }),
        root.opsChecklist.count({ where: { opsSopId: a.sop.id } }),
        root.opsSopTeam.count({ where: { opsSopId: a.sop.id } }),
        root.notification.count({ where: { opsSopId: a.sop.id } }),
      ]);
      ok("deleting an SOP takes its versions, confirmations, ticks, teams and bell rows", left.every((n) => n === 0), left.join());
    });
    await runInTenant(B, async () => {
      ok("B's SOP is still there", (await svc.get(b.admin.id, b.sop.id)).version === 1);
    });
  } finally {
    await cleanup(root);
    await root.$disconnect();
  }

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall business ops Postgres checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
