/**
 * Macros on real Postgres: the tenant-scoped store, and one workspace's saved
 * replies staying its own.
 *
 * Two workspaces each write a macro for their own team. Acting as the second,
 * the first's can't be listed, read, changed, deleted or offered to one of its
 * conversations, and none of its teams can be given a macro. Then the store's
 * own behaviour: shortcuts unique per workspace (not across them), team links
 * replaced on save and dropped with their team.
 *
 *     DATABASE_URL=… pnpm check:macros-pg
 */
import { PrismaClient } from "@prisma/client";
import { MacrosService } from "../apps/api/src/macros/macros.service";
import { PrismaMacroStore } from "../apps/api/src/macros/prisma-macro.store";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { createMacroInputSchema } from "../packages/schemas/src";

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

const A = "macchk_a";
const B = "macchk_b";

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [A, B];
  await root.macro.deleteMany({ where: { orgId: { in: orgs } } }); // team links cascade
  const convs = (await root.conversation.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((c) => c.id);
  await root.message.deleteMany({ where: { conversationId: { in: convs } } });
  await root.participant.deleteMany({ where: { conversationId: { in: convs } } });
  await root.assignmentEvent.deleteMany({ where: { conversationId: { in: convs } } });
  await root.conversation.deleteMany({ where: { id: { in: convs } } });
  await root.contactIdentity.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { contact: { orgId: { in: orgs } } }] } });
  await root.contact.deleteMany({ where: { orgId: { in: orgs } } });
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
  const macros = new PrismaMacroStore(root as unknown as PrismaService);
  const svc = new MacrosService(macros, store);
  await cleanup(root);
  for (const id of [A, B]) await root.organization.create({ data: { id, name: id } });

  const build = (org: string, tag: string) =>
    runInTenant(org, async () => {
      const team = await store.createTeam({ orgId: org, name: `${tag} support` });
      const other = await store.createTeam({ orgId: org, name: `${tag} sales` });
      const { user } = await store.createUser({
        orgId: org, name: `${tag} admin`, email: `macchk-${tag}@example.com`, role: "admin", teamIds: [team.id], password: "x-password-1",
      });
      const inbox = await store.createInbox({
        orgId: org, type: "whatsapp", name: `${tag} WA`, handle: `macchk_${tag}`, teamIds: [team.id], routingStrategy: "manual",
      });
      const contact = await store.upsertContactByIdentity({ orgId: org, kind: "phone", value: `+4477009002${tag === "a" ? "01" : "02"}`, displayName: `${tag} Sarah` });
      const { conversation } = await store.findOrCreateOpenConversation({ orgId: org, inboxId: inbox.id, contact, channel: "whatsapp" });
      const macro = await svc.create(
        user.id,
        createMacroInputSchema.parse({ name: `${tag} delayed`, shortcut: "delayed", body: `${tag} secret reply`, teamIds: [team.id] }),
      );
      return { team, other, user, inbox, conversation, macro };
    });

  try {
    const a = await build(A, "a");
    const b = await build(B, "b");

    console.log("\nOne workspace's macros are its own\n");
    ok("both workspaces can use the same shortcut", a.macro.shortcut === "delayed" && b.macro.shortcut === "delayed");
    await runInTenant(B, async () => {
      const list = await svc.list();
      ok("B lists only its own", list.length === 1 && list[0]!.id === b.macro.id);
      ok("A's macro can't be read by id", (await macros.get(a.macro.id)) === undefined);
      ok("or found by its shortcut", (await macros.byShortcut("delayed"))?.id === b.macro.id);
      ok("or changed", await refuses(() => svc.update(b.user.id, a.macro.id, { body: "hijacked" })));
      ok("or deleted", await refuses(() => svc.remove(b.user.id, a.macro.id)));
      ok("A's team can't be given one of B's macros", await refuses(() => svc.update(b.user.id, b.macro.id, { teamIds: [a.team.id] })));
      ok(
        "not even through the store directly",
        await macros
          .create({ name: "x", shortcut: null, body: "x", teamIds: [a.team.id] }, { id: null, name: "x" })
          .then(
            () => false,
            (e: Error) => e.name === "TenantViolationError",
          ),
      );
      ok("A's conversation isn't offered anything", await refuses(() => svc.forConversation(a.conversation.id)));
      ok("B's own conversation gets B's macro", (await svc.forConversation(b.conversation.id)).map((m) => m.id).join() === b.macro.id);
    });
    await runInTenant(A, async () => {
      const mine = await macros.get(a.macro.id);
      ok("A's macro is untouched", mine?.body === "a secret reply" && mine.teamIds.join() === a.team.id);
    });

    console.log("\nThe store\n");
    await runInTenant(A, async () => {
      ok("a shortcut is unique within a workspace", await refuses(() => svc.create(a.user.id, createMacroInputSchema.parse({ name: "again", shortcut: "delayed", body: "x" }))));
      const moved = await svc.update(a.user.id, a.macro.id, { teamIds: [a.other.id, a.team.id] });
      ok("saving replaces its teams", moved.teamIds.length === 2 && moved.teamIds.includes(a.other.id));
      ok("and records who saved it", moved.updatedBy?.name === "a admin");
      const twice = await svc.create(a.user.id, createMacroInputSchema.parse({ name: "twice", body: "x", teamIds: [a.team.id, a.team.id] }));
      ok("a team ticked twice is saved once", twice.teamIds.join() === a.team.id);
      await store.deleteTeam(a.other.id);
      ok("deleting a team drops it from the macro", (await macros.get(a.macro.id))?.teamIds.join() === a.team.id);
      await svc.remove(a.user.id, a.macro.id);
      ok("deleting a macro takes its team links with it", (await root.macroTeam.count({ where: { macroId: a.macro.id } })) === 0);
    });
  } finally {
    await cleanup(root);
    await root.$disconnect();
  }

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall macro Postgres checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
