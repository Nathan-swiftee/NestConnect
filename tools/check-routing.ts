/**
 * Which team does a new conversation land on?
 *
 * Sibling to `check-threading.ts`, and there for the same reason: this is a
 * rule with several inputs that can only disagree in one direction at a time,
 * and every way of getting it wrong produces a conversation that looks
 * completely normal — it is simply sitting in front of the wrong people. No
 * request fails, nothing typechecks differently, and the customer who asked for
 * billing and got sales just waits.
 *
 * The rule, in the order it is applied:
 *
 *   1. A team the customer asked for, by picking an option on a NestChat
 *      pre-chat form. This sits above the owner deliberately — the owner is a
 *      fact about the relationship, the option is a fact about the conversation
 *      that is starting right now.
 *   2. Their own account manager, when they have one.
 *   3. The channel's own team, per its assignment strategy.
 *
 * And the one place 1 and 2 cooperate rather than compete: if the customer's own
 * person is on the team that was asked for, they get it. The customer reaches
 * billing, and billing turns out to be somebody who already knows them.
 *
 * Runs against `MemoryStore`, which satisfies the same `Store` interface the
 * Prisma one does, so this is a check of the rule rather than of a query.
 *
 *     pnpm check:routing
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID } from "../apps/api/src/data/fixtures";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import type { Contact, Inbox } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const ORG = "org_demo";
/** Nathan is on both teams; James is support only; Amara is sales only. */
const NATHAN = DEMO_USER_ID;
const AMARA = "usr_amara";

async function main(): Promise<void> {
  const store = new MemoryStore();
  const routing = new RoutingService(store);

  // A channel serving both teams, assigning manually — so what these checks
  // read is the *team*, without a rotation moving under them.
  const channel = (over: Partial<Inbox> = {}): Inbox => ({
    id: "inbox_chat",
    orgId: ORG,
    type: "nestchat",
    name: "Website chat",
    handle: "website",
    teamIds: ["team_support", "team_sales"],
    routingStrategy: "manual",
    unread: 0,
    ...over,
  });

  const visitor = await store.upsertContactByIdentity({
    orgId: ORG,
    kind: "nestchat",
    value: "ffffffffffffffff",
    displayName: "Routing Check",
  });
  /** The same person, with an account manager on the support team. */
  const owned: Contact = { ...visitor, ownerUserId: NATHAN, ownerTeamId: "team_support" };
  /** …and one whose account manager is on neither of the teams asked for. */
  const ownedElsewhere: Contact = { ...visitor, ownerUserId: AMARA, ownerTeamId: "team_sales" };

  console.log("\na new conversation lands on the team it was asked for\n");

  const plain = await routing.route(channel(), visitor);
  ok("nobody asked, nobody owns them → the channel's own team", plain.assignedTeamId === "team_support",
    `team ${plain.assignedTeamId}`);

  const asked = await routing.route(channel(), visitor, { optionTeamId: "team_sales" });
  ok("they asked for sales → sales", asked.assignedTeamId === "team_sales",
    `team ${asked.assignedTeamId}`);

  const ownerNoAsk = await routing.route(channel(), owned);
  ok("no menu, but they have an account manager → their manager",
    ownerNoAsk.assigneeUserId === NATHAN && ownerNoAsk.assignedTeamId === "team_support");

  // The decision this feature turns on, and the one worth writing down: an
  // explicit ask outranks the relationship.
  const askedOverOwner = await routing.route(channel(), ownedElsewhere, { optionTeamId: "team_support" });
  ok("they asked for support, their manager is on sales → support wins",
    askedOverOwner.assignedTeamId === "team_support" && askedOverOwner.assigneeUserId === null,
    `team ${askedOverOwner.assignedTeamId}, agent ${askedOverOwner.assigneeUserId}`);

  // …but the owner is kept whenever keeping them costs nothing.
  const bothAgree = await routing.route(channel(), owned, { optionTeamId: "team_support" });
  ok("they asked for support and their manager is on support → their manager",
    bothAgree.assigneeUserId === NATHAN && bothAgree.assignedTeamId === "team_support");

  // A stale option — its team taken off the channel — resolves to null upstream
  // in NestChatService, so what arrives here is "no ask". It must fall all the
  // way back rather than assigning nowhere.
  const stale = await routing.route(channel(), owned, { optionTeamId: null });
  ok("an option whose team has gone falls back to the ordinary rules",
    stale.assigneeUserId === NATHAN && stale.assignedTeamId === "team_support");

  console.log("\nthe asked-for team is also the pool an auto-assignment draws from\n");

  const auto = await routing.route(channel({ routingStrategy: "round_robin" }), visitor, {
    optionTeamId: "team_sales",
  });
  const salesMembers = (await store.getMembers("team_sales")).map((m) => m.id);
  ok("round robin over a chosen team picks somebody on it",
    auto.assigneeUserId !== null && salesMembers.includes(auto.assigneeUserId),
    `agent ${auto.assigneeUserId} of ${salesMembers.join(", ")}`);

  // Nobody available on the asked-for team is a queue item on that team, not a
  // handover to a team that happens to have somebody free.
  for (const m of await store.getMembers("team_sales")) {
    await store.updateMyPreferences(m.id, { available: false });
  }
  const noneFree = await routing.route(channel({ routingStrategy: "round_robin" }), visitor, {
    optionTeamId: "team_sales",
  });
  ok("nobody free on the chosen team → its queue, not another team's",
    noneFree.assigneeUserId === null && noneFree.assignedTeamId === "team_sales",
    `team ${noneFree.assignedTeamId}`);

  console.log(failed ? `\n${failed} failed\n` : "\nall good\n");
  process.exit(failed ? 1 : 0);
}

void main();
