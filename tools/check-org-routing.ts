/**
 * An organisation's routing: its people's new chats go to its team (and
 * optionally its person), unless a contact has routing of their own.
 *
 *   A  setting it: admins and managers only; the person must be on the team;
 *      the profile says how many of its people it reaches;
 *   B  the order: the customer's own routing beats the organisation's, the
 *      organisation's beats the channel's, and a live-chat menu choice beats
 *      both (keeping the organisation's person if they're on that team);
 *   C  the organisation's person is skipped while away, and the team takes it;
 *   D  which organisation: their one organisation, or the only routed one of
 *      several — never a guess between two; archived ones and deleted teams
 *      don't route.
 *
 *     pnpm check:org-routing
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { routingAccount, type Contact, type Inbox } from "../packages/schemas/src/index";

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

const NATHAN = DEMO_USER_ID; // admin, Support + Sales
const JAMES = "usr_james"; // agent, Support
const AMARA = "usr_amara"; // agent, Sales

async function main(): Promise<void> {
  const store = new MemoryStore();
  const accounts = new AccountsService(new MemoryAccountStore(), store);
  const routing = new RoutingService(store, accounts);
  const inbox = (over: Partial<Inbox> = {}): Inbox => ({
    id: "inbox_chat",
    orgId: ORG_ID,
    type: "nestchat",
    name: "Website chat",
    handle: "website",
    teamIds: ["team_support"],
    routingStrategy: "manual",
    unread: 0,
    ...over,
  });

  await runInTenant(ORG_ID, async () => {
    const person = async (name: string, n: string): Promise<Contact> =>
      store.upsertContactByIdentity({ orgId: ORG_ID, kind: "phone", value: `+4477009004${n}`, displayName: name });
    const marta = await person("Marta", "01");
    const kim = await person("Kim", "02");
    const lee = await person("Lee", "03");
    const sam = await person("Sam", "04");
    const acme = await accounts.create(NATHAN, { name: "Acme Ltd", contactIds: [marta.id, kim.id, lee.id, sam.id] });
    const fresh = async (c: Contact) => (await store.getContact(c.id))!;

    console.log("\nA — setting it\n");
    ok("an agent can't", await refuses(accounts.setRouting(JAMES, acme.id, { teamId: "team_sales", userId: null }), 403));
    ok("a person needs a team", await refuses(accounts.setRouting(NATHAN, acme.id, { teamId: null, userId: AMARA }), 400));
    ok("the person must be on the team", await refuses(accounts.setRouting(NATHAN, acme.id, { teamId: "team_sales", userId: JAMES }), 400));
    ok("the team must exist", await refuses(accounts.setRouting(NATHAN, acme.id, { teamId: "team_nope", userId: null }), 400));
    await store.updateContact(kim.id, { ownerTeamId: "team_support" });
    const set = await accounts.setRouting(NATHAN, acme.id, { teamId: "team_sales", userId: AMARA });
    ok("a manager can: Sales, Amara", set.account.routeTeamId === "team_sales" && set.account.routeUserId === AMARA);
    ok("the profile says who it reaches", set.routing.appliesTo === 3 && set.routing.ownRouting === 1, JSON.stringify(set.routing));
    const listed = (await accounts.forContact(marta.id))[0]?.account;
    ok("a contact's organisations carry it", listed?.routeTeamId === "team_sales");
    ok("it's in the organisation's activity", (await accounts.activity(acme.id)).some((a) => a.summary === "Routed new chats to Sales team · Amara"));

    console.log("\nB — the order\n");
    let r = await routing.route(inbox(), await fresh(marta));
    ok("Marta (no routing of her own) → Acme's: Sales, Amara", r.assignedTeamId === "team_sales" && r.assigneeUserId === AMARA, JSON.stringify(r));
    r = await routing.route(inbox(), await fresh(kim));
    ok("Kim's own team wins over Acme's", r.assignedTeamId === "team_support" && r.assigneeUserId === null, JSON.stringify(r));
    await store.updateContact(lee.id, { ownerUserId: JAMES });
    r = await routing.route(inbox(), await fresh(lee));
    ok("so does Lee's own person", r.assigneeUserId === JAMES, JSON.stringify(r));
    r = await routing.route(inbox(), await fresh(marta), { optionTeamId: "team_support" });
    ok("a menu choice beats it", r.assignedTeamId === "team_support" && r.assigneeUserId !== AMARA, JSON.stringify(r));
    r = await routing.route(inbox(), await fresh(marta), { optionTeamId: "team_sales" });
    ok("and keeps Amara when Sales is what they picked", r.assignedTeamId === "team_sales" && r.assigneeUserId === AMARA, JSON.stringify(r));
    const outsider = await person("No Org", "05");
    r = await routing.route(inbox(), outsider);
    ok("someone in no organisation → the channel's team", r.assignedTeamId === "team_support");

    console.log("\nC — their person is away\n");
    await store.updateMyPreferences(AMARA, { available: false });
    r = await routing.route(inbox({ routingStrategy: "round_robin" }), await fresh(marta));
    ok("Amara away → Sales takes it, by the channel's strategy", r.assignedTeamId === "team_sales" && r.assigneeUserId === NATHAN, JSON.stringify(r));
    r = await routing.route(inbox(), await fresh(marta));
    ok("on a manual channel it waits in Sales' queue", r.assignedTeamId === "team_sales" && r.assigneeUserId === null, JSON.stringify(r));
    await store.updateMyPreferences(AMARA, { available: true });
    await accounts.setRouting(NATHAN, acme.id, { teamId: "team_sales", userId: null });
    r = await routing.route(inbox(), await fresh(marta));
    ok("team only: Sales' queue", r.assignedTeamId === "team_sales" && r.assigneeUserId === null, JSON.stringify(r));

    console.log("\nD — which organisation\n");
    const beta = await accounts.create(NATHAN, { name: "Beta plc", contactIds: [marta.id] });
    r = await routing.route(inbox(), await fresh(marta));
    ok("in two, only Acme routes → Acme's", r.assignedTeamId === "team_sales", JSON.stringify(r));
    await accounts.setRouting(NATHAN, beta.id, { teamId: "team_support", userId: JAMES });
    r = await routing.route(inbox({ teamIds: ["team_support"] }), await fresh(marta));
    ok("in two that both route → neither: the channel's team", r.assignedTeamId === "team_support" && r.assigneeUserId === null, JSON.stringify(r));
    ok("and that's reported as unclear, not silently picked", (await accounts.detail(acme.id)).routing.unclear === 1);
    await accounts.setArchived(NATHAN, beta.id, true);
    r = await routing.route(inbox(), await fresh(marta));
    ok("an archived organisation doesn't route (back to Acme)", r.assignedTeamId === "team_sales", JSON.stringify(r));
    await store.deleteTeam("team_sales");
    r = await routing.route(inbox(), await fresh(marta));
    ok("a deleted team doesn't route (the channel's team)", r.assignedTeamId === "team_support", JSON.stringify(r));
    const cleared = await accounts.setRouting(NATHAN, acme.id, { teamId: null, userId: null });
    ok("routing can be switched off", cleared.account.routeTeamId === null);

    ok(
      "the rule on its own: one organisation without routing decides nothing",
      routingAccount([{ id: "a", name: "A", routeTeamId: null }]).account === null,
    );
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall organisation routing checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
