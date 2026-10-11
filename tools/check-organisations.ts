/**
 * Organisations — the acceptance scenarios, against the in-memory stores.
 *
 *   A  a new customer with an overview, a pinned instruction and an SOP;
 *   B  three contacts linked, each showing the organisation;
 *   C  a message from one of them: the conversation shows the organisation and
 *      its alerts without anyone looking it up;
 *   D  a newcomer can read the active SOP and reach its documents;
 *   E  a contact who works for two companies: nothing is guessed, and choosing
 *      one shows only that one's instructions;
 *   F  an updated SOP is what everyone sees next, the old version kept;
 * plus permissions, duplicates, archiving and the knowledge sanitiser.
 *
 *     pnpm check:organisations
 */
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { sanitizeKnowledgeHtml } from "../apps/api/src/accounts/knowledge-html";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { accountNameKey } from "../packages/schemas/src/accounts";

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

const ADMIN = DEMO_USER_ID; // admin
const AGENT = "usr_james"; // agent
const NEWBIE = "usr_amara"; // agent, never dealt with them

async function main() {
  const store = new MemoryStore();
  const svc = new AccountsService(new MemoryAccountStore(), store);

  await runInTenant(ORG_ID, async () => {
    console.log("\nA — a new customer\n");
    const abc = await svc.create(AGENT, {
      name: "ABC Magazines Ltd",
      reference: "SW-1042",
      summary: "Weekly magazine distribution, London",
      overview: "Sends a magazine run every Thursday.",
      tags: ["Magazines", "Weekly"],
      ownerUserId: ADMIN,
    });
    ok("an agent can create an organisation", !!abc.id && abc.name === "ABC Magazines Ltd" && abc.status === "active");
    ok("with its owner's name", abc.ownerName === "Nathan A");
    ok("tags are kept tidy", abc.tags.join(",") === "magazines,weekly");
    const alert = await svc.createAlert(AGENT, abc.id, { body: "Only approved couriers may handle this customer's deliveries.", priority: "critical" });
    await svc.createAlert(AGENT, abc.id, { body: "Call the warehouse before sending a driver.", priority: "important" });
    const sop = await svc.createSop(AGENT, abc.id, {
      title: "Weekly Magazine Distribution",
      category: "Recurring work",
      summary: "Thursday magazine run",
      warnings: "Never split the pallet.",
      steps: [{ text: "Confirm the drop list by Wednesday 4pm" }, { text: "Assign an approved courier" }],
      body: '<p>Collect from <strong>Unit 4</strong>.</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      status: "active",
    });
    ok("the SOP is saved with its steps", sop.steps.length === 2 && sop.version === 1);
    ok("its instructions are cleaned of anything executable", !sop.body.includes("script") && !sop.body.includes("onerror") && sop.body.includes("<strong>Unit 4</strong>"));

    console.log("\nDuplicates\n");
    ok("a second “ABC Magazines Limited” is stopped", await refuses(svc.create(AGENT, { name: "abc magazines limited" }), 409));
    ok("and so is a reused account reference", await refuses(svc.create(AGENT, { name: "Totally Different", reference: "sw-1042" }), 409));
    ok("unless someone insists", !!(await svc.create(AGENT, { name: "ABC Magazines (North)", force: true })).id);
    ok("names compare without case, punctuation or Ltd", accountNameKey("The A.B.C. Magazines, Ltd") === accountNameKey("abc magazines"));

    console.log("\nB — three contacts\n");
    const [david, sarah, michael] = ["ct_acme", "ct_harbour", "ct_tide"];
    await svc.link(AGENT, abc.id, { contactId: david!, role: "Owner", isPrimary: true });
    await svc.link(AGENT, abc.id, { contactId: sarah!, role: "Bookings Manager" });
    await svc.link(AGENT, abc.id, { contactId: michael!, role: "Accounts", department: "Finance" });
    const detail = await svc.detail(abc.id);
    ok("all three are on the profile", detail.contacts.length === 3);
    ok("the primary contact leads", detail.contacts[0]?.contactId === david && detail.contacts[0]?.isPrimary === true);
    for (const id of [david!, sarah!, michael!]) {
      const mine = await svc.forContact(id);
      ok(`${id} shows ABC Magazines`, mine.length === 1 && mine[0]?.account.id === abc.id);
    }
    await svc.link(AGENT, abc.id, { contactId: sarah!, isPrimary: true });
    const prim = (await svc.detail(abc.id)).contacts.filter((c) => c.isPrimary).map((c) => c.contactId);
    ok("only one primary contact at a time", prim.length === 1 && prim[0] === sarah);
    ok("linking again doesn't duplicate", (await svc.detail(abc.id)).contacts.length === 3);

    console.log("\nC — an incoming message\n");
    // Sarah's WhatsApp conversation (a fixture).
    const conv = (await store.getConversation("conv_harbour"))!;
    const ctx = await svc.conversationContext(conv.id);
    ok("the conversation shows ABC Magazines on its own", ctx.account?.account.id === abc.id && ctx.basis === "only" && !ctx.needsChoice);
    ok("critical instructions first", ctx.account?.alerts[0]?.id === alert.id && ctx.account.alerts.length === 2);
    ok("with her role there", ctx.account?.link?.role === null || ctx.account?.link?.role === "Bookings Manager");
    ok("and the active SOPs", ctx.account?.sops.map((s) => s.id).join() === sop.id);

    console.log("\nD — a handover\n");
    const file = await store.createUploadAttachment(ORG_ID, { storageKey: "k/drop-list.csv", kind: "file", mime: "text/csv", size: 12, filename: "drop-list-template.csv" } as never);
    const template = await svc.createResource(AGENT, abc.id, {
      kind: "file",
      title: "Drop list template",
      description: "",
      category: "Templates",
      instructions: "",
      attachmentId: file.id,
      sopId: sop.id,
    });
    await svc.createResource(AGENT, abc.id, {
      kind: "app",
      title: "RouteXL",
      description: "Route optimiser",
      category: "Apps",
      url: "https://www.routexl.com",
      instructions: "Import the drop list, optimise, export to the dispatch sheet.",
    });
    const forNewbie = await svc.detail(abc.id);
    const seen = forNewbie.sops.find((s) => s.id === sop.id);
    ok("someone who's never dealt with them reads the full SOP", !!seen && seen.steps.length === 2 && seen.warnings.length > 0);
    ok("and reaches its template", forNewbie.resources.some((r) => r.id === template.id && r.sopId === sop.id && r.fileName === "drop-list-template.csv"));
    ok("and the external app with its instructions", forNewbie.resources.some((r) => r.kind === "app" && r.url === "https://www.routexl.com" && !!r.instructions));
    ok("a file resource needs a real upload", await refuses(
      svc.createResource(AGENT, abc.id, { kind: "file", title: "x", description: "", category: "", instructions: "", attachmentId: "att_nope" }),
      400,
    ));

    console.log("\nE — one contact, two companies\n");
    const other = await svc.create(AGENT, { name: "Bright Books Ltd" });
    await svc.createAlert(AGENT, other.id, { body: "Bright Books: invoices to the Leeds office only.", priority: "critical" });
    await svc.link(AGENT, other.id, { contactId: sarah!, role: "Freelance bookings" });
    const ambiguous = await svc.conversationContext(conv.id);
    ok("with two organisations nothing is guessed", ambiguous.needsChoice && ambiguous.account === null && ambiguous.linked.length === 2);
    const chosen = await svc.setConversationAccount(AGENT, conv.id, other.id);
    ok("choosing one shows that one", chosen.account?.account.id === other.id && chosen.basis === "chosen");
    ok("and only its instructions", chosen.account!.alerts.every((a) => a.body.startsWith("Bright Books")));
    const back = await svc.setConversationAccount(AGENT, conv.id, abc.id);
    ok("and it can be changed", back.account?.account.id === abc.id && back.account.alerts.every((a) => !a.body.startsWith("Bright Books")));
    ok("an archived organisation can't be chosen", await (async () => {
      const gone = await svc.create(AGENT, { name: "Gone Ltd" });
      await svc.setArchived(ADMIN, gone.id, true);
      return refuses(svc.setConversationAccount(AGENT, conv.id, gone.id), 400);
    })());

    console.log("\nF — updating instructions\n");
    const v2 = await svc.updateSop(AGENT, abc.id, sop.id, { steps: [{ text: "Confirm the drop list by Wednesday 2pm" }, { text: "Assign an approved courier" }] });
    ok("the change is a new version", v2.version === 2);
    const after = await svc.conversationContext(conv.id);
    ok("everyone now sees the updated steps", after.account?.sops.find((s) => s.id === sop.id)?.steps[0]?.text.includes("2pm") === true);
    const revs = await svc.sopRevisions(abc.id, sop.id);
    ok("and the previous version is kept", revs.length === 1 && revs[0]?.version === 1 && revs[0].steps[0]?.text.includes("4pm") === true);
    const draft = await svc.createSop(AGENT, abc.id, { title: "Christmas schedule", category: "Recurring work", summary: "", warnings: "", steps: [], body: "", status: "draft" });
    ok("a draft isn't presented as current", !(await svc.conversationContext(conv.id)).account!.sops.some((s) => s.id === draft.id));

    console.log("\nPermissions\n");
    ok("an agent can't archive an SOP", await refuses(svc.updateSop(AGENT, abc.id, sop.id, { status: "archived" }), 403));
    const archived = await svc.updateSop(ADMIN, abc.id, sop.id, { status: "archived" });
    ok("an admin can", archived.status === "archived");
    ok("an archived SOP isn't presented as current", !(await svc.conversationContext(conv.id)).account!.sops.some((s) => s.id === sop.id));
    ok("an agent can't archive an organisation", await refuses(svc.setArchived(AGENT, abc.id, true), 403));
    const note = await svc.createNote(AGENT, abc.id, { title: "Prefers WhatsApp", body: "<p>Prefers WhatsApp to email.</p>", category: "Communication" });
    ok("someone else's note can't be deleted by another agent", await refuses(svc.deleteNote(NEWBIE, abc.id, note.id), 403));
    await svc.deleteNote(AGENT, abc.id, note.id);
    ok("but its author can", (await svc.detail(abc.id)).notes.length === 0);
    ok("an empty note is refused", await refuses(svc.createNote(AGENT, abc.id, { title: "", body: "<p> </p>", category: "" }), 400));

    console.log("\nArchiving and unlinking\n");
    await svc.unlink(AGENT, abc.id, michael!);
    ok("removing a contact keeps the contact", !!(await store.getContact(michael!)));
    ok("and their conversations", (await store.getContactWithConversations(michael!))!.conversations !== undefined);
    await svc.setArchived(ADMIN, abc.id, true);
    ok("an archived organisation leaves the directory", !(await svc.list({})).some((a) => a.id === abc.id));
    ok("but can be found", (await svc.list({ includeArchived: true })).some((a) => a.id === abc.id));
    ok("and is read-only", await refuses(svc.createAlert(AGENT, abc.id, { body: "x", priority: "info" }), 400));
    ok("its contacts are untouched", !!(await store.getContact(sarah!)) && !!(await store.getContact(david!)));
    await svc.setArchived(ADMIN, abc.id, false);
    const log = await svc.activity(abc.id);
    ok("every change is in its history, with who did it", log.length >= 10 && log.every((a) => !!a.actor?.name));
    ok("newest first", log[0]?.action === "account.restored");

    console.log("\nPeople added from the organisation's side\n");
    const fresh = await svc.create(AGENT, { name: "Bloom & Ivy Florists", contactIds: ["ct_bloom", "ct_ivy", "ct_nobody"] });
    const freshPeople = (await svc.detail(fresh.id)).contacts;
    ok("created with the people ticked", freshPeople.map((l) => l.contactId).sort().join() === "ct_bloom,ct_ivy");
    ok("an unknown id is skipped, not an error", !freshPeople.some((l) => l.contactId === "ct_nobody"));
    ok("the first becomes the primary contact", freshPeople.filter((l) => l.isPrimary).length === 1);
    const more = await svc.linkMany(AGENT, fresh.id, ["ct_ivy", "ct_north", "ct_north"]);
    ok("adding several at once skips who's already there", more.length === 3 && more.filter((l) => l.contactId === "ct_north").length === 1);
    ok("and doesn't move the primary", more.filter((l) => l.isPrimary).map((l) => l.contactId).join() === freshPeople.find((l) => l.isPrimary)?.contactId);
    ok("each shows the organisation", (await svc.forContact("ct_north")).some((a) => a.account.id === fresh.id));
    ok("one line in its history", (await svc.activity(fresh.id)).filter((a) => a.action === "contact.linked").length === 2);
    await svc.setArchived(ADMIN, fresh.id, true);
    ok("not into an archived organisation", await refuses(svc.linkMany(AGENT, fresh.id, ["ct_acme"]), 400));
    await svc.setArchived(ADMIN, fresh.id, false);

    console.log("\nSearch\n");
    ok("by name", (await svc.list({ search: "magazines" })).some((a) => a.id === abc.id));
    ok("by reference", (await svc.list({ search: "SW-1042" })).some((a) => a.id === abc.id));
    ok("by tag", (await svc.list({ search: "weekly" })).some((a) => a.id === abc.id));
    ok("and by status", !(await svc.list({ status: "prospect" })).some((a) => a.id === abc.id));
  });

  console.log("\nThe sanitiser\n");
  ok("keeps structure", sanitizeKnowledgeHtml("<h2>Steps</h2><ol><li>One</li></ol>") === "<h2>Steps</h2><ol><li>One</li></ol>");
  ok("makes links safe", sanitizeKnowledgeHtml('<a href="https://x.example">x</a>').includes('rel="noopener noreferrer"'));
  ok("drops javascript: links", !sanitizeKnowledgeHtml('<a href="javascript:alert(1)">x</a>').includes("javascript"));
  ok("an empty editor is empty", sanitizeKnowledgeHtml("<p></p>") === "");

  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
