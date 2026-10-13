/**
 * Customers › select: one action on many customers, against the in-memory store.
 *
 *   A  tagging adds a tag to everyone ticked, without doubling one they have
 *      (whatever its case) or touching their other tags; taking one off leaves
 *      the rest;
 *   B  blocking and unblocking skip anyone already that way;
 *   C  deleting many is for admins and managers only; ids already gone are
 *      counted, not an error;
 *   D  customers who share nothing — no number, no email — merge into the one
 *      kept, their conversations with them.
 *
 *     pnpm check:customer-bulk
 */
import { ContactsController } from "../apps/api/src/contacts/contacts.controller";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { bulkContactsInputSchema, type BulkContactsInput } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function threw<T>(p: Promise<T>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err;
  }
}

async function main() {
  const store = new MemoryStore();
  const controller = new ContactsController(store, {} as never, new AccountsService(new MemoryAccountStore(), store));
  // Through the same validation the HTTP body gets.
  const bulk = (userId: string, input: BulkContactsInput) => controller.bulk(userId, bulkContactsInputSchema.parse(input));

  await runInTenant(ORG_ID, async () => {
    const make = async (displayName: string, extra: { phone?: string; email?: string; tags?: string[] }) =>
      (await store.createContact({ orgId: ORG_ID, displayName, ...extra })).contact;
    const a = await make("Ada Shore", { phone: "+447700900101", tags: ["VIP"] });
    const b = await make("Ben Marsh", { email: "ben@marsh.test", tags: ["wholesale"] });
    const c = await make("B. Marsh (old)", { phone: "+447700900999" });
    const tagsOf = async (id: string) => (await store.getContact(id))?.tags ?? [];

    console.log("\nA — tags\n");
    const tagged = await bulk(DEMO_USER_ID, { action: "tag", ids: [a.id, b.id, c.id], add: ["vip", "Spring promo"] });
    ok("added to everyone ticked", tagged.done === 3, JSON.stringify(tagged));
    ok("a tag they had, in another case, isn't doubled", (await tagsOf(a.id)).join() === "VIP,Spring promo", (await tagsOf(a.id)).join());
    ok("their other tags stay", (await tagsOf(b.id)).join() === "wholesale,vip,Spring promo", (await tagsOf(b.id)).join());
    const again = await bulk(DEMO_USER_ID, { action: "tag", ids: [a.id, b.id, c.id], add: ["VIP"] });
    ok("tagging again changes no one who has it", again.done === 0 && (await tagsOf(a.id)).length === 2, JSON.stringify(again));
    const off = await bulk(DEMO_USER_ID, { action: "tag", ids: [a.id, b.id, c.id], remove: ["spring PROMO"] });
    ok("taking one off, whatever its case, leaves the rest", off.done === 3 && (await tagsOf(b.id)).join() === "wholesale,vip", (await tagsOf(b.id)).join());
    ok("with nothing to add or take off it says so", /Pick a tag/.test(String(await threw(bulk(DEMO_USER_ID, { action: "tag", ids: [a.id] })))));

    console.log("\nB — block\n");
    const blocked = await bulk("usr_james", { action: "block", ids: [a.id, b.id], blocked: true });
    ok("an agent can block, as one at a time", blocked.done === 2 && !!(await store.getContact(a.id))?.blocked);
    const twice = await bulk("usr_james", { action: "block", ids: [a.id, b.id, c.id], blocked: true });
    ok("anyone already blocked is skipped", twice.done === 1, JSON.stringify(twice));
    await bulk("usr_james", { action: "block", ids: [a.id, b.id, c.id], blocked: false });
    ok("and unblocked again", !(await store.getContact(a.id))?.blocked && !(await store.getContact(c.id))?.blocked);

    console.log("\nC — delete\n");
    const gone = await make("Spam Sender", { email: "spam@nowhere.test" });
    const gone2 = await make("Spam Again", { email: "spam2@nowhere.test" });
    ok("an agent can't delete many at once", /admins and managers/.test(String(await threw(bulk("usr_james", { action: "delete", ids: [gone.id] })))));
    ok("…and nothing went", !!(await store.getContact(gone.id)));
    const del = await bulk(DEMO_USER_ID, { action: "delete", ids: [gone.id, gone2.id, "ct_missing"] });
    ok("an admin can, ids already gone counted", del.done === 2 && del.missing === 1 && !(await store.getContact(gone.id)) && !(await store.getContact(gone2.id)), JSON.stringify(del));
    ok("a thousand at most", !bulkContactsInputSchema.safeParse({ action: "delete", ids: Array.from({ length: 1001 }, (_, i) => `x${i}`) }).success);

    console.log("\nD — merging customers that share nothing\n");
    const merged = await controller.merge({ winnerId: b.id, loserIds: [c.id] });
    const kept = await store.getContact(b.id);
    ok("the kept one takes the other's number", merged.contact.id === b.id && kept?.phone === "+447700900999" && kept?.email === "ben@marsh.test", JSON.stringify({ phone: kept?.phone, email: kept?.email }));
    ok("and the other is gone", !(await store.getContact(c.id)));
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall customer bulk checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
