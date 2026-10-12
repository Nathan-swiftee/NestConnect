/**
 * Email signatures on real Postgres: positions and a channel's design are
 * stored and read back, and one workspace can't change another's.
 *
 *     DATABASE_URL=… pnpm check:email-signature-pg
 */
import { PrismaClient } from "@prisma/client";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const A = "sigchk_a";
const B = "sigchk_b";

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [A, B];
  await root.inboxTeam.deleteMany({ where: { inbox: { orgId: { in: orgs } } } });
  await root.inbox.deleteMany({ where: { orgId: { in: orgs } } });
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
  await cleanup(root);
  for (const id of [A, B]) await root.organization.create({ data: { id, name: id } });

  const build = (org: string, tag: string) =>
    runInTenant(org, async () => {
      const team = await store.createTeam({ orgId: org, name: `${tag} team` });
      const { user } = await store.createUser({
        orgId: org, name: `${tag} admin`, email: `sigchk-${tag}@example.com`, role: "admin", teamIds: [team.id], position: "Operations Manager", password: "x-password-1",
      });
      const mail = await store.createInbox({ orgId: org, type: "email", name: `${tag} mail`, handle: `sigchk-${tag}@example.com`, teamIds: [team.id], routingStrategy: "manual" });
      const wa = await store.createInbox({ orgId: org, type: "whatsapp", name: `${tag} WA`, handle: `sigchk_${tag}`, teamIds: [team.id], routingStrategy: "manual" });
      return { user, mail, wa };
    });

  try {
    const a = await build(A, "a");
    const b = await build(B, "b");

    console.log("\nPositions\n");
    ok("an invite stores a position", a.user.position === "Operations Manager");
    await runInTenant(A, async () => {
      await store.updateUser(a.user.id, { position: "Head of Ops" });
      ok("an admin's edit is stored", (await store.getUser(a.user.id))?.position === "Head of Ops");
      await store.updateMyProfile(a.user.id, { position: null });
      ok("and cleared", (await store.getUser(a.user.id))?.position === null);
    });
    await runInTenant(B, async () => {
      await store.updateUser(a.user.id, { position: "Hijacked" });
    });
    await runInTenant(A, async () => {
      ok("another workspace can't set it", (await store.getUser(a.user.id))?.position === null);
    });

    console.log("\nA channel's design\n");
    await runInTenant(A, async () => {
      ok("an email channel starts undesigned", a.mail.signature?.layoutHtml === null && a.mail.signature?.footerHtml === null);
      ok("other channels have no signature", a.wa.signature === undefined);
      const saved = await store.setInboxSignature(a.mail.id, { layoutHtml: "<p>{{agent.name}}</p>", footerHtml: "<p>Offer</p>" });
      ok("it is saved", saved?.signature?.layoutHtml === "<p>{{agent.name}}</p>" && saved.signature.footerHtml === "<p>Offer</p>");
      const listed = (await store.listInboxes()).find((i) => i.id === a.mail.id);
      ok("and read back with the channel", listed?.signature?.footerHtml === "<p>Offer</p>");
    });
    await runInTenant(B, async () => {
      ok("another workspace can't change it", (await store.setInboxSignature(a.mail.id, { layoutHtml: "<p>x</p>", footerHtml: null })) === undefined);
      ok("or see it", !(await store.listInboxes()).some((i) => i.id === a.mail.id) && (await store.getInbox(a.mail.id)) === undefined);
      ok("its own is its own", (await store.getInbox(b.mail.id))?.signature?.layoutHtml === null);
    });
    await runInTenant(A, async () => {
      ok("A's design is untouched", (await store.getInbox(a.mail.id))?.signature?.layoutHtml === "<p>{{agent.name}}</p>");
    });
  } finally {
    await cleanup(root);
    await root.$disconnect();
  }

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall email signature Postgres checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
