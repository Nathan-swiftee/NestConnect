/**
 * Who can open which channel's and team's conversation list.
 *
 *   A  An agent's sidebar offers only their teams and the channels routed to
 *      them, and those lists open.
 *   B  Another team's list, or a channel not routed to their teams, is refused,
 *      whether listed, counted or searched, so a link can't get round the sidebar.
 *   C  Admins and managers oversee the whole workspace: every team and channel.
 *
 *     pnpm check:channel-access
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function refused(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (err) {
    return (err as { status?: number }).status === 403;
  }
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
  const inert = new Proxy({}, { get: () => async () => {} }) as never;
  const convs = new ConversationsService(store, realtime, inert, { enqueueDelivery: async () => {} } as never, inert, { notify() {} } as never, inert);

  await runInTenant(ORG_ID, async () => {
    const sales = await store.createTeam({ orgId: ORG_ID, name: "Sales" });
    const ops = await store.createTeam({ orgId: ORG_ID, name: "Ops" });
    const salesLine = await store.createInbox({ orgId: ORG_ID, type: "whatsapp", name: "Sales line", handle: "+44 20 0000 0001", teamIds: [sales.id], routingStrategy: "manual" });
    const opsLine = await store.createInbox({ orgId: ORG_ID, type: "whatsapp", name: "Ops line", handle: "+44 20 0000 0002", teamIds: [ops.id], routingStrategy: "manual" });
    const { user: agent } = await store.createUser({ orgId: ORG_ID, name: "Sam Sales", email: "sam@example.com", role: "agent", teamIds: [sales.id] });
    const { user: manager } = await store.createUser({ orgId: ORG_ID, name: "Mo Manager", email: "mo@example.com", role: "manager", teamIds: [sales.id] });

    console.log("\nA — an agent's own team and channel\n");
    const side = await store.views(agent.id);
    const channels = side.shared.inboxes.map((i) => i.key);
    ok("the sidebar offers the Sales line", channels.includes(`inbox:${salesLine.id}`), channels.join());
    ok("…and not the Ops line", !channels.includes(`inbox:${opsLine.id}`));
    ok("…nor the Ops team", !side.shared.teams.some((t) => t.key === `team:${ops.id}`));
    ok("the Sales line opens", !(await refused(() => convs.list(`inbox:${salesLine.id}`, agent.id))));
    ok("the Sales team opens", !(await refused(() => convs.list(`team:${sales.id}`, agent.id))));
    ok("their own queues open", !(await refused(() => convs.list("inbound", agent.id))));

    console.log("\nB — anything else is refused\n");
    ok("the Ops line's list", await refused(() => convs.list(`inbox:${opsLine.id}`, agent.id)));
    ok("…its counts", await refused(() => convs.counts(`inbox:${opsLine.id}`, agent.id)));
    ok("…a search inside it", await refused(() => convs.search("hi", { view: `inbox:${opsLine.id}`, userId: agent.id })));
    ok("the Ops team's list", await refused(() => convs.list(`team:${ops.id}`, agent.id)));
    ok("a channel that no longer exists", await refused(() => convs.list("inbox:gone", agent.id)));

    console.log("\nC — managers and admins see everything\n");
    ok("a manager opens the Ops line", !(await refused(() => convs.list(`inbox:${opsLine.id}`, manager.id))));
    ok("…and the Ops team", !(await refused(() => convs.list(`team:${ops.id}`, manager.id))));
    const all = (await store.views(manager.id)).shared.inboxes.map((i) => i.key);
    ok("…and the sidebar shows both lines", all.includes(`inbox:${opsLine.id}`) && all.includes(`inbox:${salesLine.id}`));
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
