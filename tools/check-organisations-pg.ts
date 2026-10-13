/**
 * Organisations on real Postgres: the tenant-scoped store, and one business's
 * customer knowledge staying its own.
 *
 * Two workspaces each build an organisation with a contact, an alert, an SOP
 * and a document. Acting as the second, nothing of the first's can be listed,
 * read, changed, linked to or chosen for a conversation. Then the store's own
 * behaviour: SOP revisions, contact merge and delete keeping links right.
 *
 *     DATABASE_URL=… pnpm check:organisations-pg
 */
import { PrismaClient } from "@prisma/client";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { PrismaAccountStore } from "../apps/api/src/accounts/prisma-account.store";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";

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

const A = "orgchk_a";
const B = "orgchk_b";

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [A, B];
  const accounts = (await root.account.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((a) => a.id);
  await root.account.deleteMany({ where: { id: { in: accounts } } }); // knowledge cascades
  const convs = (await root.conversation.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((c) => c.id);
  const msgs = (await root.message.findMany({ where: { conversationId: { in: convs } }, select: { id: true } })).map((m) => m.id);
  await root.attachment.deleteMany({ where: { OR: [{ messageId: { in: msgs } }, { orgId: { in: orgs } }] } });
  await root.message.deleteMany({ where: { id: { in: msgs } } });
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
  const svc = new AccountsService(new PrismaAccountStore(root as unknown as PrismaService), store);
  await cleanup(root);
  for (const id of [A, B]) await root.organization.create({ data: { id, name: id } });

  const build = (org: string, tag: string) =>
    runInTenant(org, async () => {
      const team = await store.createTeam({ orgId: org, name: `${tag} team` });
      const { user } = await store.createUser({
        orgId: org, name: `${tag} admin`, email: `orgchk-${tag}@example.com`, role: "admin", teamIds: [team.id], password: "x-password-1",
      });
      const inbox = await store.createInbox({
        orgId: org, type: "whatsapp", name: `${tag} WA`, handle: `orgchk_${tag}`, teamIds: [team.id], routingStrategy: "manual",
      });
      const contact = await store.upsertContactByIdentity({ orgId: org, kind: "phone", value: `+4477009001${tag === "a" ? "01" : "02"}`, displayName: `${tag} Sarah` });
      const { conversation } = await store.findOrCreateOpenConversation({ orgId: org, inboxId: inbox.id, contact, channel: "whatsapp" });
      const upload = await store.createUploadAttachment(org, { storageKey: `orgchk/${tag}.csv`, kind: "document", mime: "text/csv", size: 3, filename: `${tag}.csv` });
      const account = await svc.create(user.id, { name: `${tag.toUpperCase()} Magazines Ltd`, summary: `${tag} secret summary` });
      await svc.link(user.id, account.id, { contactId: contact.id, role: "Bookings" });
      const alert = await svc.createAlert(user.id, account.id, { body: `${tag} secret instruction`, priority: "critical" });
      const sop = await svc.createSop(user.id, account.id, {
        title: `${tag} weekly run`, category: "Recurring work", summary: "", warnings: "", steps: [{ text: "Step one" }], body: "<p>v1</p>", status: "active",
      });
      const resource = await svc.createResource(user.id, account.id, {
        kind: "file", title: `${tag} template`, description: "", category: "Templates", instructions: "", attachmentId: upload.id, sopId: sop.id,
      });
      return { team, user, inbox, contact, conversation, upload, account, alert, sop, resource };
    });

  try {
    const a = await build(A, "a");
    const b = await build(B, "b");

    console.log("\nAs B, A's organisation doesn't exist\n");
    await runInTenant(B, async () => {
      const list = await svc.list({ includeArchived: true });
      ok("the directory lists only B's", list.length === 1 && list[0]!.id === b.account.id);
      ok("searching for A's finds nothing", (await svc.list({ search: "A Magazines" })).every((x) => x.id !== a.account.id));
      ok("A's profile reads as not found", await refuses(() => svc.detail(a.account.id)));
      ok("A's history reads as not found", await refuses(() => svc.activity(a.account.id)));
      ok("A's SOP history reads as not found", await refuses(() => svc.sopRevisions(a.account.id, a.sop.id)));
      ok("A's organisation can't be edited", await refuses(() => svc.update(b.user.id, a.account.id, { summary: "hijacked" })));
      ok("or archived", await refuses(() => svc.setArchived(b.user.id, a.account.id, true)));
      ok("its alert can't be changed", await refuses(() => svc.updateAlert(b.user.id, a.account.id, a.alert.id, { body: "x" })));
      ok("nor through B's own organisation", await refuses(() => svc.updateAlert(b.user.id, b.account.id, a.alert.id, { body: "x" })));
      ok("its SOP can't be changed via B's", await refuses(() => svc.updateSop(b.user.id, b.account.id, a.sop.id, { title: "x" })));
      ok("A's contact can't be linked to B's organisation", await refuses(() => svc.link(b.user.id, b.account.id, { contactId: a.contact.id })));
      ok("B's contact can't be linked to A's", await refuses(() => svc.link(b.user.id, a.account.id, { contactId: b.contact.id })));
      ok("nor deleted", await refuses(() => svc.remove(b.user.id, a.account.id)));
      ok("nor added in bulk to B's", !(await svc.linkMany(b.user.id, b.account.id, [a.contact.id])).some((l) => l.contactId === a.contact.id));
      ok("nor to A's in bulk", await refuses(() => svc.linkMany(b.user.id, a.account.id, [b.contact.id])));
      const sneaky = await svc.create(b.user.id, { name: "Sneaky Ltd", contactIds: [a.contact.id] });
      ok("nor ticked into a new one", (await svc.detail(sneaky.id)).contacts.length === 0);
      ok("A's upload can't become B's document", await refuses(() =>
        svc.createResource(b.user.id, b.account.id, { kind: "file", title: "x", description: "", category: "", instructions: "", attachmentId: a.upload.id }),
      ));
      ok("A's SOP can't be attached to B's resource", await refuses(() =>
        svc.createResource(b.user.id, b.account.id, { kind: "link", title: "x", description: "", category: "", instructions: "", url: "https://x.example", sopId: a.sop.id }),
      ));
      ok("B's conversation can't be put under A's organisation", await refuses(() => svc.setConversationAccount(b.user.id, b.conversation.id, a.account.id)));
      ok("A's conversation can't be read for context", await refuses(() => svc.conversationContext(a.conversation.id)));
      const ctx = await svc.conversationContext(b.conversation.id);
      ok("B's conversation shows B's organisation and only B's instructions", ctx.account?.account.id === b.account.id &&
        ctx.account.alerts.every((x) => x.body.startsWith("b ")));
    });
    await runInTenant(A, async () => {
      const d = await svc.detail(a.account.id);
      ok("A's data is unchanged", d.account.summary === "a secret summary" && d.alerts[0]?.body === "a secret instruction" && d.contacts.length === 1);
    });

    console.log("\nOrganisation routing\n");
    await runInTenant(B, async () => {
      ok("B can't route its organisation to A's team", await refuses(() => svc.setRouting(b.user.id, b.account.id, { teamId: a.team.id, userId: null })));
      ok("or to A's person", await refuses(() => svc.setRouting(b.user.id, b.account.id, { teamId: b.team.id, userId: a.user.id })));
      ok("or route A's organisation", await refuses(() => svc.setRouting(b.user.id, a.account.id, { teamId: b.team.id, userId: null })));
      ok(
        "not even through the store directly",
        await new PrismaAccountStore(root as unknown as PrismaService)
          .update(b.account.id, { routeTeamId: a.team.id }, { id: null, name: "x" })
          .then(() => false, (e: Error) => e.name === "TenantViolationError"),
      );
    });
    await runInTenant(A, async () => {
      const night = await store.createTeam({ orgId: A, name: "a night shift" });
      await store.updateUser(a.user.id, { teamIds: [a.team.id, night.id] });
      const routed = await svc.setRouting(a.user.id, a.account.id, { teamId: night.id, userId: a.user.id });
      ok("A routes its organisation to its own team and person", routed.account.routeTeamId === night.id && routed.account.routeUserId === a.user.id);
      const decision = await new RoutingService(store, svc).route(a.inbox, (await store.getContact(a.contact.id))!);
      ok("and a new chat from its contact goes there, on Postgres", decision.assignedTeamId === night.id, JSON.stringify(decision));
      await store.deleteTeam(night.id);
      const after = await root.account.findUnique({ where: { id: a.account.id }, select: { routeTeamId: true } });
      ok("deleting the team clears the organisation's routing", after?.routeTeamId === null);
    });

    console.log("\nThe store (acting as A)\n");
    await runInTenant(A, async () => {
      const v2 = await svc.updateSop(a.user.id, a.account.id, a.sop.id, { body: "<p>v2</p>", steps: [{ text: "Step one, updated" }] });
      const revs = await svc.sopRevisions(a.account.id, a.sop.id);
      ok("an SOP edit is a new version, the old one kept", v2.version === 2 && revs.length === 1 && revs[0]!.body === "<p>v1</p>" && revs[0]!.steps[0]?.text === "Step one");
      await svc.setConversationAccount(a.user.id, a.conversation.id, a.account.id);
      ok("a conversation remembers its organisation", (await root.conversation.findUnique({ where: { id: a.conversation.id } }))?.accountId === a.account.id);
      const ctx = await svc.conversationContext(a.conversation.id);
      ok("and says it was chosen", ctx.basis === "chosen" && ctx.account?.account.id === a.account.id);
      const file = (await svc.detail(a.account.id)).resources[0];
      ok("a document carries its file's name", file?.fileName === "a.csv" && file.sopId === a.sop.id);

      // The organisation replaces the old free-text Company field: it's what a
      // contact shows as their company, and what the inbox search finds.
      ok("a contact's company is their organisation", (await store.getContact(a.contact.id))?.company === "A Magazines Ltd");
      const found = await store.searchConversations("A Magazines");
      ok("searching the inbox by organisation finds their conversation", found.items.some((c) => c.id === a.conversation.id), `${found.items.length} found`);
      const imported = await store.upsertContactByIdentity({ orgId: A, kind: "email", value: "imp@a.example", displayName: "a Imported" });
      await svc.linkByName(a.user.id, imported.id, "A Magazines Limited");
      await svc.linkByName(a.user.id, imported.id, "Brand New Co");
      const theirs = (await svc.forContact(imported.id)).map((x) => x.account.name).sort();
      ok("an import's Company joins the existing organisation, or makes a new one", theirs.join() === ["A Magazines Ltd", "Brand New Co"].join(), theirs.join());
      await store.deleteContact(imported.id); // keep the counts below about Sarah

      // Merge: a second contact for the same person, linked elsewhere, folded in.
      const other = await svc.create(a.user.id, { name: "A Other Ltd" });
      const dupe = await store.upsertContactByIdentity({ orgId: A, kind: "email", value: "sarah@a.example", displayName: "a Sarah (email)" });
      await svc.link(a.user.id, other.id, { contactId: dupe.id, role: "Owner" });
      await svc.link(a.user.id, a.account.id, { contactId: dupe.id });
      await store.mergeContacts({ winnerId: a.contact.id, loserIds: [dupe.id] } as never);
      const mine = await svc.forContact(a.contact.id);
      ok("merging contacts brings their organisations along", mine.map((m) => m.account.id).sort().join() === [a.account.id, other.id].sort().join(), mine.map((m) => m.account.name).join());
      ok("without doubling a shared one", (await svc.detail(a.account.id)).contacts.length === 1);

      await svc.setArchived(a.user.id, other.id, true);
      ok("archiving keeps the contact", !!(await store.getContact(a.contact.id)));
      await store.deleteContact(a.contact.id);
      ok("deleting a contact removes only their links", (await svc.detail(a.account.id)).contacts.length === 0 && !!(await svc.detail(a.account.id)).account);
      ok("their conversations go with them, as before (the organisation stays)", (await root.conversation.findUnique({ where: { id: a.conversation.id } })) === null);
      const log = await svc.activity(a.account.id);
      ok("the history records it all, newest first", log.length >= 6 && log[0]!.createdAt >= log[log.length - 1]!.createdAt);

      // Deleting for good: everything that belongs to it goes, in one cascade.
      const keep = await store.upsertContactByIdentity({ orgId: A, kind: "email", value: "keep@a.example", displayName: "a Keep" });
      await svc.link(a.user.id, a.account.id, { contactId: keep.id });
      await svc.remove(a.user.id, a.account.id);
      const left = await Promise.all([
        root.account.count({ where: { id: a.account.id } }),
        root.accountContact.count({ where: { accountId: a.account.id } }),
        root.accountAlert.count({ where: { accountId: a.account.id } }),
        root.accountSop.count({ where: { accountId: a.account.id } }),
        root.accountSopRevision.count({ where: { sopId: a.sop.id } }),
        root.accountResource.count({ where: { accountId: a.account.id } }),
        root.accountActivity.count({ where: { accountId: a.account.id } }),
      ]);
      ok("deleting an organisation removes it and everything it held", left.every((n) => n === 0), left.join(","));
      ok("but not its people", !!(await store.getContact(keep.id)));
      ok("nor B's organisation", (await root.account.count({ where: { id: b.account.id } })) === 1);
    });
  } finally {
    await cleanup(root);
    await root.$disconnect();
  }
  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
