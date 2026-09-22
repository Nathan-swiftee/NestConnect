/**
 * The order channels are listed in.
 *
 * Reported as "they're just showing in random orders", and that was literally
 * true: the sidebar's inbox query had no `ORDER BY` at all, so Postgres
 * returned rows in whatever order the heap held them — which changes as rows
 * are updated, so the sidebar could reshuffle between two page loads of the
 * same workspace.
 *
 * Teams already had this. What is being matched here is that behaviour:
 *
 *   1. The order somebody chose wins, everywhere channels are listed.
 *   2. Every existing row starts at 0, so a workspace that has never touched
 *      the arrows keeps the order it had rather than being reshuffled by the
 *      feature arriving.
 *   3. A new channel lands at the end, not the top of somebody's arrangement.
 *   4. Ids that are not in a reorder keep their relative order after the ones
 *      that are — a channel connected in another tab must not vanish.
 *
 *     pnpm check:channel-order
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name).join(", ");

async function main(): Promise<void> {
  const store = new MemoryStore();

  const add = (name: string) =>
    store.createInbox({
      orgId: ORG_ID,
      type: "email",
      name,
      handle: `${name}@example.com`,
      teamIds: [],
      routingStrategy: "manual",
    });

  console.log("\nBefore anybody touches the arrows\n");
  const seeded = await store.listInboxes();
  ok(
    "the channels that were already there keep their order",
    // Everything starts at 0, so this is entirely tie-break — which is the
    // state every real workspace is in the moment this ships.
    names(seeded) === names(await store.listInboxes()),
    names(seeded),
  );

  const a = await add("Alpha");
  const b = await add("Bravo");
  const c = await add("Charlie");

  console.log("\nA new channel joins\n");
  const after = await store.listInboxes();
  ok("it goes on the end", after[after.length - 1]!.id === c.id, names(after));
  ok(
    "and the ones before it keep their order",
    after.findIndex((x) => x.id === a.id) < after.findIndex((x) => x.id === b.id),
  );

  console.log("\nSomebody uses the arrows\n");
  await store.reorderInboxes([c.id, a.id, b.id]);
  const moved = (await store.listInboxes()).filter((i) => [a.id, b.id, c.id].includes(i.id));
  ok("the chosen order is what comes back", names(moved) === "Charlie, Alpha, Bravo", names(moved));

  const echo = await add("Echo");
  const arranged = await store.listInboxes();
  ok(
    "a channel connected afterwards still lands at the end",
    // The assertion that matters, and the one the earlier "goes on the end"
    // cannot make: before any reorder every row ties at 0, so a new channel
    // sorts last by insertion order whatever its own order says. Only once
    // somebody has arranged the list does leaving a new row at 0 put it above
    // the ones they arranged — which is the bug this guards.
    arranged[arranged.length - 1]!.id === echo.id,
    names(arranged),
  );

  const sidebar = await store.views("usr_nathan");
  const sidebarNames = sidebar.shared.inboxes
    .filter((v) => ["Alpha", "Bravo", "Charlie"].includes(v.title))
    .map((v) => v.title)
    .join(", ");
  ok(
    "and the sidebar agrees with the settings screen",
    // The two read through different code paths. They disagreed before this:
    // one sorted, the other did not sort at all.
    sidebarNames === "Charlie, Alpha, Bravo",
    sidebarNames,
  );

  console.log("\nA channel nobody mentioned\n");
  const d = await add("Delta");
  await store.reorderInboxes([b.id, a.id]);
  const partial = await store.listInboxes();
  ok(
    "a reorder that omits it does not lose it",
    partial.some((i) => i.id === d.id),
    names(partial),
  );
  ok(
    "and it stays after the ones that were reordered",
    // Two ids were given positions 0 and 1; anything untouched keeps a higher
    // order and sorts after them. A channel connected in another tab must not
    // be able to jump the queue by not being mentioned.
    partial.findIndex((i) => i.id === d.id) > partial.findIndex((i) => i.id === a.id),
    names(partial),
  );

  console.log("\nAn id that is not ours\n");
  const before = names(await store.listInboxes());
  await store.reorderInboxes(["inbox_does_not_exist", a.id]);
  ok(
    "is ignored rather than throwing",
    // The list comes from a client. A stale tab sending a deleted id should
    // not fail the whole reorder for everything else in it.
    (await store.listInboxes()).length === before.split(", ").length,
  );

  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

void main();
