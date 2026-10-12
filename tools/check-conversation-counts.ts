/**
 * The numbers on the conversation list's filter chips.
 *
 * They were counted on the client, over the rows it had loaded — and the list
 * is paged, thirty at a time. So "Unread 4" meant "4 among the first thirty",
 * and the number crept up as somebody scrolled. Now the server counts the whole
 * view, and this pins two things:
 *
 *   1. Each count is the true total, however many pages the view runs to.
 *   2. Each count agrees with what its filter would actually list — counted
 *      here by paging through the real list endpoint to the end, in every
 *      kind of view. A chip that says 12 above a list of 11 is the bug again.
 *
 *     pnpm check:conversation-counts
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import type { Conversation, ConversationFilterCounts } from "../packages/schemas/src/index";
import { CONVERSATIONS_PAGE_SIZE } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** The whole view, the way a client would get it: page after page. */
async function everything(store: MemoryStore, view: string, userId: string): Promise<Conversation[]> {
  const out: Conversation[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await store.listConversations(view, userId, { cursor });
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}

/** What each chip should say, worked out from the full list. */
function expected(rows: Conversation[], userId: string): ConversationFilterCounts {
  const live = rows.filter((c) => c.status !== "closed");
  return {
    all: live.length,
    unread: live.filter((c) => c.unread || (c.unreadCount ?? 0) > 0).length,
    mine: live.filter((c) => c.assigneeUserId === userId).length,
    unassigned: live.filter((c) => !c.assigneeUserId).length,
    groups: live.filter((c) => c.channel === "whatsapp_group").length,
    closed: rows.filter((c) => c.status === "closed").length,
  };
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const userId = store.demoUserId;
  const inboxes = await store.listInboxes();
  const inbox = inboxes[0]!;

  // Well past one page, with every kind of row a chip counts.
  const extra = CONVERSATIONS_PAGE_SIZE * 3;
  for (let i = 0; i < extra; i++) {
    const { contact } = await store.createContact({
      orgId: ORG_ID,
      displayName: `Customer ${i}`,
      phone: `+4477009${String(10000 + i)}`,
    });
    const { conversation } = await store.findOrCreateOpenConversation({
      orgId: ORG_ID,
      inboxId: inbox.id,
      contact,
      channel: i % 9 === 0 ? "whatsapp_group" : inbox.type,
      assigneeUserId: i % 3 === 0 ? userId : null,
    });
    if (i % 4 === 0) await store.markUnread(conversation.id);
    if (i % 7 === 0) await store.setStatus(conversation.id, "closed");
  }

  const views = ["inbound", "mine", "grabs", `inbox:${inbox.id}`, `team:${inbox.teamIds[0]}`];
  for (const view of views) {
    console.log(`\n${view}\n`);
    const rows = await everything(store, view, userId);
    const want = expected(rows, userId);
    const got = await store.conversationFilterCounts(view, userId);
    for (const key of Object.keys(want) as (keyof ConversationFilterCounts)[]) {
      ok(`${key} is the whole view's`, got[key] === want[key], `${got[key]} vs ${want[key]}`);
    }
    if (view === "inbound") {
      const firstPage = (await store.listConversations(view, userId)).items;
      ok(
        "and more than one page holds",
        rows.length > firstPage.length && got.all > expected(firstPage, userId).all,
        `${rows.length} rows, first page ${firstPage.length}`,
      );
    }
  }

  // The @ Mentions badge: open work only, like every other queue. A mention in
  // a chat that has since been closed used to keep the badge at 1 for good.
  console.log("\n@ Mentions badge\n");
  const fresh = new MemoryStore();
  const me = (await fresh.getUser(fresh.demoUserId))!;
  const james = (await fresh.getUser("usr_james"))!;
  const handle = "@" + me.email.split("@")[0]!.toLowerCase();
  const mentionsBadge = async () => (await fresh.views(me.id)).my.find((v) => v.key === "mentions")?.count ?? -1;
  const before = await mentionsBadge();
  await fresh.addMessage("conv_north", { body: `${handle} can you look at this?`, internal: true }, james);
  ok("a note mentioning me lights the badge", (await mentionsBadge()) === before + 1, `${before} → ${await mentionsBadge()}`);
  await fresh.setStatus("conv_north", "closed");
  ok("closing that chat clears it", (await mentionsBadge()) === before, String(await mentionsBadge()));
  ok(
    "the chat is still in the Mentions list, under Closed",
    (await everything(fresh, "mentions", me.id)).some((c) => c.id === "conv_north" && c.status === "closed"),
  );
  await fresh.setStatus("conv_north", "open");
  ok("reopening it brings it back", (await mentionsBadge()) === before + 1);

  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
