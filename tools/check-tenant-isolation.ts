/**
 * Tenant isolation, against a real Postgres.
 *
 * Two workspaces share one database: `org_swiftee` — the id the production
 * workspace has always had — and a second one. Each is given the same kinds of
 * data, including the same customer phone number, and then the second is turned
 * loose on the first: every list it can ask for, every id it could guess, every
 * write it could aim across the boundary. Nothing of the first may come back,
 * change, or be created on its behalf.
 *
 * The rules this pins:
 *   1. Lists show only the bound workspace's rows.
 *   2. An id from another workspace reads as "not found" — never as the row.
 *   3. A write aimed at another workspace's id changes nothing there.
 *   4. A create that names another workspace is refused outright.
 *   5. Nothing reads workspace data with no workspace bound.
 *   6. The deliberate cross-workspace lookups (sign-in by email, the inbox a
 *      webhook is for) are unambiguous, and the platform's settings are shared
 *      while a workspace's own are not.
 *
 *     DATABASE_URL=postgres://… pnpm check:tenant-isolation
 *
 * Needs a migrated, empty-or-disposable database: it creates and removes its
 * own rows, all under ids prefixed `iso_`, plus the platform org if missing.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import { runInTenant, TenantNotBoundError } from "../apps/api/src/tenancy/tenant-scope";
import { TenantViolationError } from "../apps/api/src/data/tenant-prisma";
import { PLATFORM_ORG_ID } from "../apps/api/src/tenancy/platform";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function rejects(fn: () => Promise<unknown>, kind?: new (...a: never[]) => Error): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    return kind ? err instanceof kind || (err as Error)?.name === kind.name : true;
  }
}

const A = PLATFORM_ORG_ID; // the production workspace's id
const B = "iso_org_b";
const SAME_PHONE = "+447700900123"; // one customer, messaging both businesses

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required — this check runs against a real Postgres.");
    process.exit(1);
  }
  const root = new PrismaClient();
  await root.$connect();
  const store = new PrismaStore(root as unknown as PrismaService, new SecretEncryptionService());

  await cleanup(root);
  await root.organization.upsert({ where: { id: A }, create: { id: A, name: "Platform" }, update: {} });
  await root.organization.create({ data: { id: B, name: "Second workspace" } });

  /* ---------------- each workspace builds the same shapes of data ---------------- */

  const build = (org: string, tag: string, phoneNumberId: string, mailbox: string) =>
    runInTenant(org, async () => {
      const team = await store.createTeam({ orgId: org, name: `${tag} team` });
      const { user } = await store.createUser({
        orgId: org,
        name: `${tag} agent`,
        email: `iso-${tag}@example.com`,
        role: "admin",
        teamIds: [team.id],
        password: `${tag}-password`,
      });
      const wa = await store.createInbox({
        orgId: org, type: "whatsapp", name: `${tag} WhatsApp`, handle: phoneNumberId,
        teamIds: [team.id], routingStrategy: "manual",
        channelConfig: { phoneNumberId, accessToken: `${tag}-secret-token` },
      });
      const email = await store.createInbox({
        orgId: org, type: "email", name: mailbox, handle: mailbox,
        teamIds: [team.id], routingStrategy: "manual",
      });
      const chat = await store.createInbox({
        orgId: org, type: "nestchat", name: `${tag} chat`, handle: `${tag}-chat`,
        teamIds: [team.id], routingStrategy: "manual",
        channelConfig: { widgetKey: `iso_wk_${tag}`, appKey: `iso_ak_${tag}` },
      });
      const contact = await store.upsertContactByIdentity({
        orgId: org, kind: "phone", value: SAME_PHONE, displayName: `${tag} customer`,
      });
      const { conversation } = await store.findOrCreateOpenConversation({
        orgId: org, inboxId: wa.id, contact, channel: "whatsapp",
      });
      const inbound = await store.appendInboundMessage(conversation.id, {
        authorName: contact.displayName,
        body: `${tag} secret order details`,
        channelMsgId: `wamid.iso_${tag}`,
        channel: "whatsapp",
        attachments: [{ storageKey: `iso/${tag}.jpg`, kind: "image", mime: "image/jpeg", size: 10, filename: `${tag}.jpg` }],
      });
      const staged = await store.createUploadAttachment(org, {
        storageKey: `iso/${tag}-staged.pdf`, kind: "document", mime: "application/pdf", size: 10, filename: `${tag}-staged.pdf`,
      });
      const label = await store.createLabel({ orgId: org, name: `${tag} VIP`, color: "#000000" });
      await store.setConversationLabels(conversation.id, [label.id]);
      const template = await store.createTemplate(org, {
        name: `${tag}_template`, category: "utility", language: "en", body: `Hi from ${tag}`,
      } as never);
      const field = await store.createCustomField(org, { key: `${tag}_order`, label: "Order", entity: "conversation", type: "text" } as never);
      await store.setCustomFieldValues(org, "conversation", conversation.id, { [`${tag}_order`]: `${tag}-001` });
      await store.setAppSetting(org, "iso_workspace_setting", `${tag} value`);
      const session = await store.createSession(user.id, { ip: "127.0.0.1" });
      await store.upsertDevice({ userId: user.id, sessionId: session.id, pushToken: `ExponentPushToken[iso_${tag}]`, platform: "ios" });
      await store.createNotification({ userId: user.id, type: "mention", title: `${tag} mention`, conversationId: conversation.id });
      await store.recordWebhookDiagnostic({ channel: "whatsapp", kind: "bad_signature", reference: tag, orgId: org });
      return { team, user, wa, email, chat, contact, conversation, inbound: inbound!, staged, label, template, field, session };
    });

  const a = await build(A, "a", "iso_phone_a", "iso-a@example.com");
  const b = await build(B, "b", "iso_phone_b", "iso-b@example.com");
  await store.recordWebhookDiagnostic({ channel: "whatsapp", kind: "unmapped_inbox", reference: "iso_unmapped" });

  console.log("\nThe same customer, two businesses\n");
  ok("one phone number gives each workspace its own contact", a.contact.id !== b.contact.id);
  ok("…and its own conversation", a.conversation.id !== b.conversation.id);

  /* ---------------- 1. lists ---------------- */
  console.log("\nLists show only the bound workspace (acting as B)\n");
  await runInTenant(B, async () => {
    const only = <T extends { id: string }>(label: string, rows: T[], mine: string[], theirs: string[]) => {
      const ids = new Set(rows.map((r) => r.id));
      ok(`${label}: B's are there`, mine.every((id) => ids.has(id)));
      ok(`${label}: none of A's`, theirs.every((id) => !ids.has(id)));
    };
    only("inboxes", await store.listInboxes(), [b.wa.id, b.email.id, b.chat.id], [a.wa.id, a.email.id, a.chat.id]);
    only("teams", await store.listTeams(), [b.team.id], [a.team.id]);
    only("people", (await store.listMembers()).map((m) => m.user), [b.user.id], [a.user.id]);
    only("contacts", await store.listContacts(), [b.contact.id], [a.contact.id]);
    only("labels", await store.listLabels(B), [b.label.id], [a.label.id]);
    only("templates", await store.listTemplates(B), [b.template.id], [a.template.id]);
    only("custom fields", await store.listCustomFields(B), [b.field.id], [a.field.id]);
    for (const view of ["inbound", "mine", "all", "unassigned"]) {
      const page = await store.listConversations(view, b.user.id).catch(() => ({ items: [] as { id: string }[] }));
      ok(`conversations "${view}": none of A's`, !page.items.some((c) => c.id === a.conversation.id));
    }
    const search = await store.searchConversations("secret order details");
    ok("search for A's message text finds none of A's threads", !search.items.some((c) => c.id === a.conversation.id));
    ok("…and does find B's own", search.items.some((c) => c.id === b.conversation.id));
    const searchA = await store.searchConversations("a-001");
    ok("search by A's custom field value finds nothing of A's", !searchA.items.some((c) => c.id === a.conversation.id));
    const diag = await store.listWebhookDiagnostics();
    ok("webhook diagnostics: B's own only", diag.some((d) => d.reference === "b") && !diag.some((d) => d.reference === "a"));
    ok("…not the unmatched ones, which are the operator's", !diag.some((d) => d.reference === "iso_unmapped"));
    const notes = await store.listNotifications(b.user.id);
    ok("notifications: B's only", notes.length > 0 && notes.every((n) => n.title.startsWith("b ")));
    const dupes = await store.findDuplicateContacts();
    ok("duplicate finder never pairs B's customer with A's", !JSON.stringify(dupes).includes(a.contact.id));
    const values = await store.customFieldValues(B, "conversation", [a.conversation.id]);
    ok("custom field values of A's conversation: none", Object.keys(values).length === 0 || JSON.stringify(values) === "{}" || !JSON.stringify(values).includes("a-001"));
    const analytics = await store.getAnalytics(B, { from: new Date(0).toISOString(), to: new Date(Date.now() + 864e5).toISOString() } as never).catch((e) => e as Error);
    ok("analytics run for B without touching A's", !(analytics instanceof Error) && !JSON.stringify(analytics).includes(a.conversation.id));
  });

  /* ---------------- 2. ids from the other workspace ---------------- */
  console.log("\nA's ids read as not found (acting as B)\n");
  await runInTenant(B, async () => {
    const none = async (label: string, fn: () => Promise<unknown>) => {
      const r = await fn().catch(() => undefined);
      const empty = r === undefined || r === null || (Array.isArray(r) && r.length === 0) ||
        (typeof r === "object" && r !== null && "items" in r && (r as { items: unknown[] }).items.length === 0) ||
        (typeof r === "object" && r !== null && "messages" in r && !("id" in r) && (r as { messages: unknown[] }).messages.length === 0);
      ok(label, empty, empty ? "" : JSON.stringify(r).slice(0, 120));
    };
    await none("getConversation", () => store.getConversation(a.conversation.id));
    await none("listMessages", () => store.listMessages(a.conversation.id));
    await none("listParticipants", () => store.listParticipants(a.conversation.id));
    await none("getInbox", () => store.getInbox(a.wa.id));
    await none("getInboxConfig (A's access token)", () => store.getInboxConfig(a.wa.id));
    await none("getTeam", () => store.getTeam(a.team.id));
    await none("getUser", () => store.getUser(a.user.id));
    await none("getContact", () => store.getContact(a.contact.id));
    await none("getContactWithConversations", () => store.getContactWithConversations(a.contact.id));
    await none("getTemplate", () => store.getTemplate(a.template.id));
    await none("getAttachment (sent)", () => store.getAttachment(a.inbound.attachments[0]!.id));
    await none("getAttachmentAccess (sent)", () => store.getAttachmentAccess(a.inbound.attachments[0]!.id));
    await none("getAttachmentAccess (staged upload)", () => store.getAttachmentAccess(a.staged.id));
    await none("getSession", () => store.getSession(a.session.id));
    await none("listSessions of A's user", () => store.listSessions(a.user.id));
    await none("listDevices of A's user", () => store.listDevices(a.user.id));
    await none("getOutboundMessage", () => store.getOutboundMessage(a.inbound.id));
    await none("getMessageRefByChannelId", () => store.getMessageRefByChannelId("wamid.iso_a"));
    await none("getTwoFactor of A's user", () => store.getTwoFactor(a.user.id));
    await none("getPasswordHash of A's user", () => store.getPasswordHash(a.user.id));
    await none("findContactByIdentity with A's org", () =>
      store.findContactByIdentity({ orgId: A, kind: "phone", value: SAME_PHONE }));
    await none("getAppSetting of A", () => store.getAppSetting(A, "iso_workspace_setting"));
    ok("getAppSetting of B is B's own", (await store.getAppSetting(B, "iso_workspace_setting")) === "b value");
  });

  /* ---------------- 3. writes aimed across ---------------- */
  console.log("\nWrites aimed at A change nothing there (acting as B)\n");
  await runInTenant(B, async () => {
    const attempt = (fn: () => Promise<unknown>) => fn().catch(() => undefined);
    await attempt(() => store.setStatus(a.conversation.id, "closed"));
    await attempt(() => store.assign(a.conversation.id, { assigneeUserId: b.user.id }));
    await attempt(() => store.addMessage(a.conversation.id, { body: "injected", internal: false } as never));
    await attempt(() => store.updateInbox(a.wa.id, { name: "hijacked", channelConfig: { phoneNumberId: "iso_phone_b" } }));
    await attempt(() => store.deleteInbox(a.email.id));
    await attempt(() => store.updateTeam(a.team.id, { name: "hijacked" }));
    await attempt(() => store.deleteTeam(a.team.id));
    await attempt(() => store.updateUser(a.user.id, { role: "agent", name: "hijacked" }));
    await attempt(() => store.setUserPassword(a.user.id, "hijacked-password"));
    await attempt(() => store.deleteUser(a.user.id));
    await attempt(() => store.updateContact(a.contact.id, { displayName: "hijacked" } as never));
    await attempt(() => store.deleteContact(a.contact.id));
    await attempt(() => store.mergeContacts({ winnerId: b.contact.id, loserIds: [a.contact.id] }));
    await attempt(() => store.updateLabel(a.label.id, { name: "hijacked" }));
    await attempt(() => store.deleteLabel(a.label.id));
    await attempt(() => store.setConversationLabels(b.conversation.id, [a.label.id]));
    await attempt(() => store.updateTemplate(a.template.id, { body: "hijacked" } as never));
    await attempt(() => store.deleteTemplate(a.template.id));
    await attempt(() => store.deleteCustomField(a.field.id));
    await attempt(() => store.setCustomFieldValues(B, "conversation", a.conversation.id, { b_order: "x" }));
    await attempt(() => store.revokeSession(a.user.id, a.session.id));
    await attempt(() => store.revokeOtherSessions(a.user.id, ""));
    await attempt(() => store.markNotificationsRead(a.user.id));
    await attempt(() => store.reactToMessage(a.inbound.id, "👎", "user"));
    await attempt(() => store.addMessage(b.conversation.id, { body: "steal", internal: false, attachmentIds: [a.staged.id] } as never));
    await attempt(() => store.setAppSetting(B, "iso_workspace_setting", "b again"));
    const bLabels = (await store.getConversation(b.conversation.id))?.labels.map((l) => l.id) ?? [];
    ok("A's label can't be put on B's thread", !bLabels.includes(a.label.id));
    // Refused — whether the store reports it as an error or as "not found",
    // what matters is that nothing across the boundary was linked.
    await attempt(() => store.assign(b.conversation.id, { assigneeUserId: a.user.id }));
    await attempt(() => store.assign(b.conversation.id, { assignedTeamId: a.team.id }));
    const afterAssign = await store.getConversation(b.conversation.id);
    ok("A's agent can't be made assignee of B's thread", afterAssign?.assigneeUserId !== a.user.id);
    ok("A's team can't be given B's thread", afterAssign?.assignedTeamId !== a.team.id);
    await attempt(() => store.addMessage(b.conversation.id, { body: "quoting", internal: false, quotedMsgId: a.inbound.id } as never));
    const afterQuote = await store.getConversation(b.conversation.id);
    ok("A's message can't be quoted into B's thread", !afterQuote?.messages.some((m) => m.quotedMsgId === a.inbound.id) &&
      !JSON.stringify(afterQuote).includes("a secret order details"));
    await attempt(() => store.updateInbox(b.wa.id, { teamIds: [a.team.id] }));
    ok("A's team can't route B's inbox", !(await store.getInbox(b.wa.id))?.teamIds.includes(a.team.id));
    await attempt(() => store.updateUser(b.user.id, { teamIds: [a.team.id] }));
    ok("B's people can't join A's team", !(await store.listMembers()).find((m) => m.user.id === b.user.id)?.teamIds.includes(a.team.id));
    ok("an inbox can't be created under A's team", await rejects(() => store.createInbox({ orgId: B, type: "email", name: "x", handle: "iso-y@example.com", teamIds: [a.team.id], routingStrategy: "manual" })));
    ok("a user can't be created into A's team", await rejects(() => store.createUser({ orgId: B, name: "x", email: "iso-z@example.com", role: "agent", teamIds: [a.team.id] })));
    ok("B's label can't go on A's thread", (await attempt(() => store.setConversationLabels(a.conversation.id, [b.label.id]))) === undefined);
  });

  await runInTenant(A, async () => {
    const conv = await store.getConversation(a.conversation.id);
    ok("A's conversation still open, still unassigned to B", conv?.status === "open" && conv?.assigneeUserId !== b.user.id);
    ok("no message was injected into A's thread", !conv?.messages.some((m) => m.body === "injected"));
    ok("A's message reactions untouched", !conv?.messages.some((m) => m.reactions?.some((r) => r.emoji === "👎")));
    ok("A's inbox not renamed or re-pointed", (await store.getInbox(a.wa.id))?.name === "a WhatsApp" &&
      (await store.getInboxConfig(a.wa.id))?.phoneNumberId === "iso_phone_a");
    ok("A's email inbox not deleted", !!(await store.getInbox(a.email.id)));
    ok("A's team intact", (await store.getTeam(a.team.id))?.name === "a team");
    const user = await store.getUser(a.user.id);
    ok("A's admin intact (role, name)", user?.role === "admin" && user?.name === "a agent");
    const hash = await store.getPasswordHash(a.user.id);
    const bcrypt = (await import("bcryptjs")).default;
    ok("A's password unchanged", !!hash && bcrypt.compareSync("a-password", hash));
    ok("A's contact intact", (await store.getContact(a.contact.id))?.displayName === "a customer");
    ok("A's label intact", (await store.listLabels(A)).some((l) => l.id === a.label.id && l.name === "a VIP"));
    ok("A's thread carries only A's label", JSON.stringify(conv?.labels.map((l) => l.id)) === JSON.stringify([a.label.id]));
    ok("A's template intact", (await store.getTemplate(a.template.id))?.body === "Hi from a");
    ok("A's custom field intact", (await store.listCustomFields(A)).some((f) => f.id === a.field.id));
    ok("A's session not revoked", !(await store.getSession(a.session.id))?.revokedAt);
    ok("A's notifications still unread", (await store.listNotifications(a.user.id)).some((n) => !n.read));
    const staged = await store.getAttachmentAccess(a.staged.id);
    ok("A's staged upload not claimed by B's message", !!staged);
  });

  /* ---------------- 4. creates naming the other workspace ---------------- */
  console.log("\nCreates that name A are refused (acting as B)\n");
  await runInTenant(B, async () => {
    ok("createInbox for A", await rejects(() => store.createInbox({ orgId: A, type: "email", name: "x", handle: "iso-x@example.com", teamIds: [], routingStrategy: "manual" }), TenantViolationError));
    ok("createTeam for A", await rejects(() => store.createTeam({ orgId: A, name: "x" }), TenantViolationError));
    ok("createUser for A", await rejects(() => store.createUser({ orgId: A, name: "x", email: "iso-x@example.com", role: "admin", teamIds: [] }), TenantViolationError));
    ok("createLabel for A", await rejects(() => store.createLabel({ orgId: A, name: "x", color: "#000" }), TenantViolationError));
    ok("createTemplate for A", await rejects(() => store.createTemplate(A, { name: "x", category: "utility", language: "en", body: "x" } as never), TenantViolationError));
    ok("createCustomField for A", await rejects(() => store.createCustomField(A, { key: "x", label: "x", entity: "conversation", type: "text" } as never), TenantViolationError));
    ok("setAppSetting for A", await rejects(() => store.setAppSetting(A, "iso_workspace_setting", "x"), TenantViolationError));
    ok("upsertContactByIdentity for A", await rejects(() => store.upsertContactByIdentity({ orgId: A, kind: "phone", value: "+447700900999", displayName: "x" }), TenantViolationError));
  });

  /* ---------------- 5. nothing bound ---------------- */
  console.log("\nNothing reads workspace data with no workspace bound\n");
  ok("listInboxes", await rejects(() => store.listInboxes(), TenantNotBoundError));
  ok("getConversation", await rejects(() => store.getConversation(a.conversation.id), TenantNotBoundError));
  ok("listContacts", await rejects(() => store.listContacts(), TenantNotBoundError));
  ok("getUser", await rejects(() => store.getUser(a.user.id), TenantNotBoundError));
  ok("…even inside a request that hasn't bound one", await rejects(() => runInTenant(undefined, () => store.listInboxes()), TenantNotBoundError));

  /* ---------------- 6. the deliberate cross-workspace lookups ---------------- */
  console.log("\nThe deliberate cross-workspace lookups\n");
  ok("a webhook for B's number finds B's inbox", (await store.getInboxByWhatsAppPhoneId("iso_phone_b"))?.id === b.wa.id);
  ok("a webhook for A's number finds A's inbox", (await store.getInboxByWhatsAppPhoneId("iso_phone_a"))?.id === a.wa.id);
  ok("mail to B's address finds B's inbox", (await store.getInboxByEmailAddress("ISO-B@example.com"))?.id === b.email.id);
  ok("B's widget key finds B's channel", (await store.getInboxByWidgetKey("iso_wk_b"))?.id === b.chat.id);
  ok("B's app key finds B's channel", (await store.getInboxByAppKey("iso_ak_b"))?.id === b.chat.id);
  ok("signing in by email finds the right workspace's account", (await store.findUserByEmail("iso-b@example.com"))?.orgId === B);
  ok("an email can't be registered twice on the platform", await store.emailInUse("ISO-A@example.com"));
  await runInTenant(B, async () => {
    ok("B can't connect A's WhatsApp number", await store.channelKeyTaken({ phoneNumberId: "iso_phone_a" }));
    ok("B can't connect A's mailbox", await store.channelKeyTaken({ emailAddress: "iso-a@example.com" }));
    ok("B may keep its own number", !(await store.channelKeyTaken({ phoneNumberId: "iso_phone_b" })));
  });
  // A duplicate key (only reachable by bypassing the connect check) matches neither.
  await root.inbox.create({
    data: { orgId: B, type: "email", name: "dup", handle: "iso-a@example.com", channelConfig: {} },
  });
  ok("an address held by two workspaces matches neither", (await store.getInboxByEmailAddress("iso-a@example.com")) === undefined);

  // One handset, signed in first to A's account and then to B's.
  await runInTenant(B, () => store.upsertDevice({ userId: b.user.id, pushToken: "ExponentPushToken[iso_a]", platform: "ios" }));
  await runInTenant(A, async () => {
    ok("a phone that moves to another workspace's account stops notifying the old one",
      !(await store.listDevices(a.user.id)).some((d) => d.pushToken === "ExponentPushToken[iso_a]"));
  });
  await runInTenant(B, async () => {
    ok("…and notifies the account now signed in on it",
      (await store.listDevices(b.user.id)).some((d) => d.pushToken === "ExponentPushToken[iso_a]"));
  });

  await store.setPlatformSetting("iso_platform_setting", "shared");
  await runInTenant(B, async () => {
    ok("platform settings read the same from any workspace", (await store.getPlatformSetting("iso_platform_setting")) === "shared");
  });
  await runInTenant(A, async () => {
    const diag = await store.listWebhookDiagnostics();
    ok("the operator's workspace sees unmatched webhooks", diag.some((d) => d.reference === "iso_unmapped"));
    ok("…but not another workspace's own", !diag.some((d) => d.reference === "b"));
  });

  await cleanup(root);
  await root.$disconnect();
  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Remove everything this check made, children first. */
async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [PLATFORM_ORG_ID, "iso_org_b"];
  const convs = (await root.conversation.findMany({
    where: { orgId: { in: orgs }, inbox: { name: { startsWith: "" } }, contact: { displayName: { endsWith: " customer" } } },
    select: { id: true },
  })).map((c) => c.id);
  const msgs = (await root.message.findMany({ where: { conversationId: { in: convs } }, select: { id: true } })).map((m) => m.id);
  await root.attachment.deleteMany({ where: { OR: [{ messageId: { in: msgs } }, { r2Key: { startsWith: "iso/" } }] } });
  await root.emailRecipient.deleteMany({ where: { messageId: { in: msgs } } });
  await root.message.deleteMany({ where: { id: { in: msgs } } });
  await root.conversationLabel.deleteMany({ where: { conversationId: { in: convs } } });
  await root.participant.deleteMany({ where: { conversationId: { in: convs } } });
  await root.assignmentEvent.deleteMany({ where: { conversationId: { in: convs } } });
  await root.note.deleteMany({ where: { conversationId: { in: convs } } });
  await root.customFieldValue.deleteMany({ where: { entityId: { in: convs } } });
  await root.conversation.deleteMany({ where: { id: { in: convs } } });
  const users = (await root.user.findMany({ where: { email: { startsWith: "iso-" } }, select: { id: true } })).map((u) => u.id);
  await root.notification.deleteMany({ where: { userId: { in: users } } });
  await root.device.deleteMany({ where: { userId: { in: users } } });
  await root.session.deleteMany({ where: { userId: { in: users } } });
  await root.teamMember.deleteMany({ where: { userId: { in: users } } });
  await root.user.deleteMany({ where: { id: { in: users } } });
  const inboxes = (await root.inbox.findMany({ where: { orgId: { in: orgs }, OR: [{ handle: { startsWith: "iso" } }, { handle: { endsWith: "-chat" } }, { name: "dup" }] }, select: { id: true } })).map((i) => i.id);
  await root.customerDevice.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.inboxTeam.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.inbox.deleteMany({ where: { id: { in: inboxes } } });
  await root.teamMember.deleteMany({ where: { team: { name: { in: ["a team", "b team"] } } } });
  await root.team.deleteMany({ where: { orgId: { in: orgs }, name: { in: ["a team", "b team"] } } });
  const contacts = (await root.contact.findMany({ where: { displayName: { endsWith: " customer" }, orgId: { in: orgs } }, select: { id: true } })).map((c) => c.id);
  await root.contactIdentity.deleteMany({ where: { contactId: { in: contacts } } });
  await root.contact.deleteMany({ where: { id: { in: contacts } } });
  await root.label.deleteMany({ where: { name: { in: ["a VIP", "b VIP"] } } });
  await root.template.deleteMany({ where: { name: { in: ["a_template", "b_template"] } } });
  const fields = (await root.customField.findMany({ where: { key: { in: ["a_order", "b_order"] } }, select: { id: true } })).map((f) => f.id);
  await root.customFieldValue.deleteMany({ where: { fieldId: { in: fields } } });
  await root.customField.deleteMany({ where: { id: { in: fields } } });
  await root.appSetting.deleteMany({ where: { key: { in: ["iso_workspace_setting", "iso_platform_setting"] } } });
  await root.webhookDiagnostic.deleteMany({ where: { reference: { in: ["a", "b", "iso_unmapped"] } } });
  await root.organization.deleteMany({ where: { id: "iso_org_b" } });
}

void main();
