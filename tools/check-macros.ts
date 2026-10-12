/**
 * Macros — saved replies by team inbox, against the in-memory stores.
 *
 *   A  admins and managers write macros; agents can't;
 *   B  a shortcut is tidied ("/Delayed" → "delayed") and can't be used twice;
 *   C  a conversation is offered its team's macros plus every team's — the
 *      assigned team's, or before anyone picks it up, its channel's teams;
 *   D  reassigning the chat swaps the list; editing a macro's teams moves it;
 *   E  "/" lookup and ranking, and the placeholders fill in for the chat;
 *   F  another workspace sees none of it.
 *
 *     pnpm check:macros
 */
import { MacrosService } from "../apps/api/src/macros/macros.service";
import { MemoryMacroStore } from "../apps/api/src/macros/memory-macro.store";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import {
  createMacroInputSchema,
  macroQueryAt,
  resolveTemplateDefault,
  searchMacros,
  updateMacroInputSchema,
  type CreateMacroInput,
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
const parsed = (input: CreateMacroInput) => createMacroInputSchema.parse(input);
const names = (list: { name: string }[]) =>
  list
    .map((m) => m.name)
    .sort()
    .join(", ");

const ADMIN = DEMO_USER_ID;
const AGENT = "usr_james"; // agent, Support team
const MANAGER = "usr_amara"; // made a manager below

async function main() {
  const store = new MemoryStore();
  const svc = new MacrosService(new MemoryMacroStore(), store);

  await runInTenant(ORG_ID, async () => {
    await store.updateUser(MANAGER, { role: "manager" });

    console.log("\nA — who writes them\n");
    const delayed = await svc.create(
      ADMIN,
      parsed({
        name: "Delivery delayed",
        shortcut: "/Delayed",
        body: "Hi {{contact.first_name}}, sorry — your delivery is running late. {{agent.first_name}}",
      }),
    );
    ok("an admin can create a macro", !!delayed.id && delayed.updatedBy?.name === "Nathan A");
    ok("no teams means every team", delayed.teamIds.length === 0);
    const hours = await svc.create(
      MANAGER,
      parsed({ name: "Opening hours", shortcut: "hours", body: "We're open 9–5.", teamIds: ["team_support"] }),
    );
    ok("so can a manager, for one team", hours.teamIds.join() === "team_support");
    const pricing = await svc.create(
      ADMIN,
      parsed({ name: "Pricing", body: "Our price list is attached.", teamIds: ["team_sales"] }),
    );
    ok("a macro needs no shortcut", pricing.shortcut === null);
    ok("an agent can't create one", await refuses(svc.create(AGENT, parsed({ name: "Mine", body: "x" })), 403));
    ok("or change one", await refuses(svc.update(AGENT, hours.id, { body: "y" }), 403));
    ok("or delete one", await refuses(svc.remove(AGENT, hours.id), 403));
    ok("but everyone can list them", (await svc.list()).length === 3);

    console.log("\nB — shortcuts and validation\n");
    ok("the shortcut is stored without its slash, lower-case", delayed.shortcut === "delayed");
    ok(
      "a shortcut can't be used twice",
      await refuses(svc.create(ADMIN, parsed({ name: "Late", shortcut: "DELAYED", body: "x" })), 409),
    );
    ok("a macro can keep its own shortcut on save", (await svc.update(ADMIN, delayed.id, updateMacroInputSchema.parse({ shortcut: "delayed", name: "Delivery delayed" }))).shortcut === "delayed");
    ok("spaces aren't allowed in a shortcut", !createMacroInputSchema.safeParse({ name: "A", body: "b", shortcut: "two words" }).success);
    ok("an empty shortcut is none", createMacroInputSchema.parse({ name: "A", body: "b", shortcut: " / " }).shortcut === null);
    ok("a macro needs text", !createMacroInputSchema.safeParse({ name: "A", body: "   " }).success);
    ok(
      "a team that doesn't exist is refused",
      await refuses(svc.create(ADMIN, parsed({ name: "Ghost", body: "x", teamIds: ["team_nope"] })), 400),
    );
    ok("an unknown macro is a 404", await refuses(svc.update(ADMIN, "mac_nope", { body: "x" }), 404));

    console.log("\nC — which a conversation is offered\n");
    // conv_north: WhatsApp, assigned to Support.
    ok(
      "a Support chat gets Support's and every team's",
      names(await svc.forConversation("conv_north")) === "Delivery delayed, Opening hours",
    );
    // Nobody has picked it up yet: it goes by the channel's teams.
    await store.assign("conv_tide", { assigneeUserId: null, assignedTeamId: null });
    ok(
      "an unassigned chat on a Support channel gets Support's",
      names(await svc.forConversation("conv_tide")) === "Delivery delayed, Opening hours",
    );
    const sales = await store.createInbox({
      orgId: ORG_ID,
      type: "email",
      name: "sales@swiftee.co.uk",
      handle: "sales@swiftee.co.uk",
      teamIds: ["team_sales"],
      routingStrategy: "manual",
    });
    const contact = (await store.getConversation("conv_bloom"))!.contact;
    const { conversation: fresh } = await store.findOrCreateOpenConversation({
      orgId: ORG_ID,
      inboxId: sales.id,
      contact,
      channel: "email",
      forceNew: true,
    });
    await store.assign(fresh.id, { assigneeUserId: null, assignedTeamId: null });
    ok(
      "an unassigned chat on a Sales channel gets Sales' instead",
      names(await svc.forConversation(fresh.id)) === "Delivery delayed, Pricing",
    );
    ok("an unknown conversation is a 404", await refuses(svc.forConversation("conv_nope"), 404));

    console.log("\nD — moving things\n");
    await store.assign("conv_north", { assignedTeamId: "team_sales" });
    ok(
      "assigning the chat to Sales swaps the list",
      names(await svc.forConversation("conv_north")) === "Delivery delayed, Pricing",
    );
    await svc.update(ADMIN, hours.id, updateMacroInputSchema.parse({ teamIds: ["team_support", "team_sales"] }));
    ok(
      "giving a macro a second team shows it there too",
      names(await svc.forConversation("conv_north")) === "Delivery delayed, Opening hours, Pricing",
    );
    await svc.update(ADMIN, hours.id, updateMacroInputSchema.parse({ teamIds: [] }));
    ok("clearing its teams makes it every team's", (await svc.list()).find((m) => m.id === hours.id)!.teamIds.length === 0);
    await svc.remove(MANAGER, pricing.id);
    const twice = await svc.update(ADMIN, hours.id, updateMacroInputSchema.parse({ teamIds: ["team_sales", "team_sales"] }));
    ok("a team ticked twice is kept once", twice.teamIds.join() === "team_sales");
    await svc.update(ADMIN, hours.id, updateMacroInputSchema.parse({ teamIds: [] }));
    ok("a deleted macro is gone", !(await svc.list()).some((m) => m.id === pricing.id));
    ok("deleting it twice is a 404", await refuses(svc.remove(ADMIN, pricing.id), 404));

    console.log("\nE — in the composer\n");
    const all = await svc.list();
    ok("“/del” finds Delivery delayed", searchMacros(all, "del")[0]?.name === "Delivery delayed");
    ok("an exact shortcut comes first", searchMacros(all, "/hours")[0]?.name === "Opening hours");
    ok("the text is searched too", searchMacros(all, "9–5")[0]?.name === "Opening hours");
    ok("nothing matches nonsense", searchMacros(all, "zzz").length === 0);
    ok("“/” at the start opens the list", macroQueryAt("/de", 3)?.query === "de");
    ok("so does one after a space", JSON.stringify(macroQueryAt("Hi /de", 6)) === JSON.stringify({ start: 3, query: "de" }));
    ok("but not in a link or a fraction", macroQueryAt("https://x", 9) === null && macroQueryAt("1/2", 3) === null);
    ok("and not once a space follows", macroQueryAt("/de x", 5) === null);
    const filled = resolveTemplateDefault(delayed.body, { contactName: "Marta Kowalska", agentName: "Nathan A" });
    ok("placeholders fill in for the chat", filled === "Hi Marta, sorry — your delivery is running late. Nathan", filled);
  });

  console.log("\nF — another workspace\n");
  await runInTenant("org_elsewhere", async () => {
    ok("sees none of these macros", (await svc.list()).length === 0);
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall macro checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
