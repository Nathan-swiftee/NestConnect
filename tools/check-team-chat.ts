/**
 * Team Chat, against the in-memory stores.
 *
 *   A  the module is off until an admin switches it on; off, nothing answers;
 *   B  every team has a chat, and its members are whoever is on the team today;
 *   C  managers and admins create groups; group admins run them; people who
 *      join see what's said from then on; the last admin leaving hands it on;
 *   D  a direct chat is one per pair, whoever starts it;
 *   E  messages: replies, @mentions, edits within 15 minutes, delete for
 *      everyone, one reaction each;
 *   F  ticks and unread counts come from each person's read marker;
 *   G  who's told: everyone else, not a muted chat — but a mention always;
 *   H  admins read any chat, read-only, and each look is recorded;
 *   I  pinned chats first; a deleted team's chat stays, read-only.
 *
 * (One workspace not seeing another's chats is proven on Postgres, in
 * check-tenant-isolation.)
 *
 *     pnpm check:team-chat
 */
import { ChatService } from "../apps/api/src/chat/chat.service";
import { MemoryChatStore } from "../apps/api/src/chat/memory-chat.store";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import type { PushRequest, PushService } from "../apps/api/src/push/push.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { chatSystemText, chatTicks, sendChatMessageInputSchema, type ChatRoomSummary } from "../packages/schemas/src";

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
const say = (body: string, replyToId?: string) => sendChatMessageInputSchema.parse({ body, replyToId });
const names = (rooms: ChatRoomSummary[]) => rooms.map((r) => r.name).sort().join(", ");

const NATHAN = DEMO_USER_ID; // admin, both teams
const JAMES = "usr_james"; // agent, Support team
const AMARA = "usr_amara"; // agent, Sales team

async function main() {
  const store = new MemoryStore();
  const pushes: PushRequest[] = [];
  const bells: Array<{ userId: string; type: string; chatRoomId?: string | null }> = [];
  const emitted: Array<{ users: string[]; event: string }> = [];
  const realtime = {
    registerChat() {},
    emitToUsers(users: string[], event: string) {
      emitted.push({ users, event });
    },
    emitChatPresence() {},
    onlineAmong: async () => new Set<string>(),
    isViewingChat: async () => false,
  } as unknown as RealtimeGateway;
  const push = { notify: (r: PushRequest) => pushes.push(r) } as unknown as PushService;
  const notifications = {
    create: async (userId: string, n: { type: string; chatRoomId?: string | null }) => {
      bells.push({ userId, type: n.type, chatRoomId: n.chatRoomId });
    },
  } as unknown as NotificationsService;
  const svc = new ChatService(new MemoryChatStore(), store, realtime, push, notifications);

  await runInTenant(ORG_ID, async () => {
    console.log("\nA — the switch\n");
    ok("off to begin with", (await svc.status(NATHAN)).enabled === false);
    ok("off, the list is a 404", await refuses(svc.rooms(NATHAN), 404));
    ok("an agent can't switch it on", await refuses(svc.setEnabled(JAMES, true), 403));
    const on = await svc.setEnabled(NATHAN, true);
    ok("an admin can", on.enabled && on.canCreateGroups && on.canOversee);
    const jamesStatus = await svc.status(JAMES);
    ok("an agent can't create groups or read others' chats", jamesStatus.enabled && !jamesStatus.canCreateGroups && !jamesStatus.canOversee);

    console.log("\nB — team chats follow the team\n");
    ok("Nathan, in both teams, has both team chats", names(await svc.rooms(NATHAN)) === "Sales team, Support team", names(await svc.rooms(NATHAN)));
    ok("James has Support only", names(await svc.rooms(JAMES)) === "Support team", names(await svc.rooms(JAMES)));
    ok("Amara has Sales only", names(await svc.rooms(AMARA)) === "Sales team");
    const sales = (await svc.rooms(NATHAN)).find((r) => r.name === "Sales team")!;
    ok("James can't open Sales — it doesn't exist, for him", await refuses(svc.room(JAMES, sales.id), 404));
    await store.updateUser(JAMES, { teamIds: ["team_support", "team_sales"] });
    ok("put on the Sales team, he's in its chat", names(await svc.rooms(JAMES)) === "Sales team, Support team");
    ok("and can write there", !!(await svc.send(JAMES, sales.id, say("Hi Sales 👋"))));
    await store.updateUser(JAMES, { teamIds: ["team_support"] });
    ok("taken off it, he's out again", names(await svc.rooms(JAMES)) === "Support team" && (await refuses(svc.send(JAMES, sales.id, say("x")), 404)));
    ok("a team chat can't be left", await refuses(svc.leave(AMARA, sales.id), 400));
    ok("or renamed", await refuses(svc.updateGroup(NATHAN, sales.id, { name: "x" }), 400));

    console.log("\nC — groups\n");
    ok("an agent can't create one", await refuses(svc.createGroup(JAMES, { name: "Mine", memberIds: [] }), 403));
    await store.updateUser(AMARA, { role: "manager" });
    const ops = await svc.createGroup(AMARA, { name: "Ops", emoji: "🚚", memberIds: [NATHAN] });
    ok("a manager can, and runs it", ops.canManage && ops.myRole === "admin" && ops.members.length === 2);
    await store.updateUser(AMARA, { role: "agent" });
    const opsMsgs = (await svc.messages(AMARA, ops.id)).messages;
    ok("it opens with who created it", opsMsgs[0]?.system && chatSystemText(opsMsgs[0].system) === "Amara created the group “Ops”", opsMsgs[0]?.system ? chatSystemText(opsMsgs[0].system) : "");
    ok("…and who they added", opsMsgs[1]?.system && chatSystemText(opsMsgs[1].system) === "Amara added Nathan A");
    ok("someone not in it can't see it", await refuses(svc.room(JAMES, ops.id), 404));
    const nathanInOps = await svc.room(NATHAN, ops.id);
    ok("a workspace admin can run any group, without being its admin", nathanInOps.myRole === "member" && nathanInOps.canManage);
    await svc.send(AMARA, ops.id, say("Before James joins"));
    await svc.addMembers(AMARA, ops.id, { userIds: [JAMES] });
    ok("Amara added James", (await svc.room(JAMES, ops.id)).members.length === 3);
    const jamesView = (await svc.messages(JAMES, ops.id)).messages.map((m) => m.body || (m.system ? chatSystemText(m.system) : ""));
    ok("he sees from when he joined, not before", !jamesView.includes("Before James joins") && jamesView.includes("Amara added James"), jamesView.join(" | "));
    ok("James can't rename it", await refuses(svc.updateGroup(JAMES, ops.id, { name: "Mine now" }), 403));
    await svc.updateGroup(AMARA, ops.id, { name: "Ops & Dispatch" });
    ok("Amara can, and everyone sees it", (await svc.room(JAMES, ops.id)).name === "Ops & Dispatch");
    await svc.setRole(AMARA, ops.id, JAMES, "admin");
    ok("Amara makes James an admin", (await svc.room(JAMES, ops.id)).canManage);
    await svc.setRole(AMARA, ops.id, JAMES, "member");
    await svc.leave(AMARA, ops.id);
    const after = await svc.room(NATHAN, ops.id);
    ok("the last admin leaving hands it to the longest-standing member", after.members.find((m) => m.id === NATHAN)?.role === "admin" && after.members.length === 2, after.members.map((m) => `${m.name}:${m.role}`).join(","));
    ok("Amara can't open it any more", await refuses(svc.room(AMARA, ops.id), 404));

    console.log("\nD — direct chats\n");
    ok("not with yourself", await refuses(svc.openDirect(JAMES, JAMES), 400));
    const dm = await svc.openDirect(JAMES, AMARA);
    const same = await svc.openDirect(AMARA, JAMES);
    ok("one chat per pair, whoever starts it", dm.id === same.id && dm.kind === "direct");
    ok("it reads as the other person", dm.name === "Amara" && same.name === "James");
    ok("nobody's written: it's only in the list of whoever opened it", (await svc.rooms(JAMES)).some((r) => r.id === dm.id) && !(await svc.rooms(AMARA)).some((r) => r.id === dm.id));

    console.log("\nE — messages\n");
    const hi = await svc.send(JAMES, dm.id, say("Hi Amara, got a sec?"));
    ok("once there's a message, it's in both lists", (await svc.rooms(AMARA)).some((r) => r.id === dm.id));
    const reply = await svc.send(AMARA, dm.id, say("Sure!", hi.id));
    ok("a reply quotes what it answers", reply.replyTo?.id === hi.id && reply.replyTo.body === "Hi Amara, got a sec?" && reply.replyTo.authorName === "James");
    ok("a reply to a message in another chat is refused", await refuses(svc.send(AMARA, dm.id, say("x", opsMsgs[0]!.id)), 400));
    const edited = await svc.edit(JAMES, hi.id, "Hi Amara, got a minute?");
    ok("an edit within 15 minutes", edited.body === "Hi Amara, got a minute?" && !!edited.editedAt);
    ok("only by its author", await refuses(svc.edit(AMARA, hi.id, "nope"), 403));
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60_000;
    ok("not after 15 minutes", await refuses(svc.edit(JAMES, hi.id, "too late"), 403));
    Date.now = realNow;
    let r = await svc.react(AMARA, hi.id, "👍");
    ok("a reaction", r.reactions.length === 1 && r.reactions[0]!.emoji === "👍" && r.reactions[0]!.userIds[0] === AMARA);
    r = await svc.react(AMARA, hi.id, "❤️");
    ok("another replaces it — one each", r.reactions.length === 1 && r.reactions[0]!.emoji === "❤️");
    r = await svc.react(AMARA, hi.id, "❤️");
    ok("the same again takes it off", r.reactions.length === 0);
    ok("you can't delete someone else's", await refuses(svc.remove(AMARA, hi.id), 403));
    const gone = await svc.remove(JAMES, hi.id);
    ok("delete for everyone leaves the gap, not the words", !!gone.deletedAt && gone.body === "");
    const quoted = (await svc.messages(AMARA, dm.id)).messages.find((m) => m.id === reply.id);
    ok("…and a reply to it says so", quoted?.replyTo?.deleted === true && quoted.replyTo.body === "");

    console.log("\nF — ticks and unread\n");
    const support = (await svc.rooms(JAMES)).find((r) => r.name === "Support team")!;
    // Support: Nathan and James.
    const ask = await svc.send(NATHAN, support.id, say("Can someone cover the 2pm?"));
    let room = await svc.room(NATHAN, support.id);
    ok("sent: one grey tick", chatTicks(ask, room.members, NATHAN) === "sent");
    const jamesList = await svc.rooms(JAMES);
    ok("James has one unread", jamesList.find((x) => x.id === support.id)?.unread === 1);
    room = await svc.room(NATHAN, support.id);
    ok("his app has it: two grey ticks", chatTicks(ask, room.members, NATHAN) === "delivered");
    await svc.read(JAMES, support.id);
    room = await svc.room(NATHAN, support.id);
    ok("he's read it: blue", chatTicks(ask, room.members, NATHAN) === "read");
    ok("and it's no longer unread", (await svc.rooms(JAMES)).find((x) => x.id === support.id)?.unread === 0);
    const info = await svc.info(NATHAN, ask.id);
    ok("Info says who read it", info.readBy.length === 1 && info.readBy[0]!.person.id === JAMES && !info.waiting.length);
    ok("only the sender can ask", await refuses(svc.info(JAMES, ask.id), 403));
    const opsNote = await svc.send(NATHAN, ops.id, say("Group check"));
    await svc.read(JAMES, ops.id);
    ok("in a group, blue only once everyone else has read it", chatTicks(opsNote, (await svc.room(NATHAN, ops.id)).members, NATHAN) === "read");
    const ops2 = await svc.createGroup(NATHAN, { name: "Three of us", memberIds: [JAMES, AMARA] });
    const three = await svc.send(NATHAN, ops2.id, say("Morning"));
    await svc.read(JAMES, ops2.id);
    ok("one of two read: not blue yet", chatTicks(three, (await svc.room(NATHAN, ops2.id)).members, NATHAN) !== "read");

    console.log("\nG — who's told\n");
    pushes.length = 0;
    bells.length = 0;
    await svc.setPrefs(AMARA, ops2.id, { muted: true });
    await svc.send(NATHAN, ops2.id, say("Lunch at 1?"));
    ok("everyone else who hasn't muted it gets a push", pushes.length === 1 && pushes[0]!.userIds.join() === JAMES && pushes[0]!.kind === "chat_message" && pushes[0]!.chatRoomId === ops2.id);
    ok("as the group, from whom", pushes[0]?.title === "Three of us" && pushes[0]?.body === "Nathan A: Lunch at 1?", `${pushes[0]?.title} / ${pushes[0]?.body}`);
    ok("never the author", !pushes.some((p) => p.userIds.includes(NATHAN)));
    pushes.length = 0;
    await svc.send(NATHAN, ops2.id, say("@amara can you book it?"));
    ok("a mention reaches a muted person, as a bell entry", bells.length === 1 && bells[0]!.userId === AMARA && bells[0]!.type === "chat_mention" && bells[0]!.chatRoomId === ops2.id);
    ok("and isn't pushed twice", !pushes.some((p) => p.userIds.includes(AMARA)));
    const amaraRoom = (await svc.rooms(AMARA)).find((x) => x.id === ops2.id)!;
    ok("the list flags the mention", amaraRoom.mentioned && amaraRoom.muted);
    const amaraUnread = (await svc.rooms(AMARA)).filter((x) => !x.muted).reduce((n, x) => n + x.unread, 0);
    ok("a muted chat doesn't count towards the badge", amaraRoom.unread > 0 && (await svc.status(AMARA)).unread === amaraUnread);
    pushes.length = 0;
    await svc.send(JAMES, dm.id, say("One more thing"));
    ok("in a direct chat, the push is from them", pushes[0]?.title === "James" && pushes[0]?.body === "One more thing");

    console.log("\nH — admins read along\n");
    const all = await svc.rooms(NATHAN, true);
    const theirs = all.find((x) => x.id === dm.id);
    ok("an admin's 'all chats' includes other people's direct chats", !!theirs && theirs.isMember === false && theirs.name === "James & Amara", theirs?.name);
    const amaraAll = await svc.rooms(AMARA, true);
    ok("an agent asking for all gets only their own", amaraAll.every((x) => x.isMember) && !amaraAll.some((x) => x.id === support.id));
    const peek = await svc.room(NATHAN, dm.id);
    ok("an admin opens it read-only", peek.oversight && !peek.canPost && peek.myRole === null);
    ok("and can't write in it", await refuses(svc.send(NATHAN, dm.id, say("hello")), 403));
    ok("or react", await refuses(svc.react(NATHAN, reply.id, "👍"), 403));
    await svc.room(NATHAN, dm.id);
    const looks = await svc.audits(NATHAN, dm.id);
    ok("the look is recorded, once for a quick re-open", looks.length === 1 && looks[0]!.person.id === NATHAN);
    ok("only admins see that record", await refuses(svc.audits(JAMES, dm.id), 403));
    ok("an admin reading along gets no unread counts or delivered ticks", (await svc.room(NATHAN, dm.id)).unread === 0);

    console.log("\nI — the list, and deleted teams\n");
    await svc.setPrefs(JAMES, ops.id, { pinned: true });
    ok("pinned first", (await svc.rooms(JAMES))[0]?.id === ops.id);
    await svc.setPrefs(JAMES, ops.id, { pinned: false });
    await store.deleteTeam("team_sales");
    ok("a deleted team's chat leaves everyone's list", !(await svc.rooms(NATHAN)).some((x) => x.id === sales.id));
    const old = (await svc.rooms(NATHAN, true)).find((x) => x.id === sales.id);
    ok("but is kept, archived, for admins to read", !!old?.archived && !old.isMember && old.name === "Sales team", `${old?.name} ${old?.archived}`);
    ok("its messages are still there", (await svc.messages(NATHAN, sales.id)).messages.some((m) => m.body === "Hi Sales 👋"));
    ok("and nobody can write in it", await refuses(svc.send(NATHAN, sales.id, say("anyone?")), 403));
    ok("an agent can't open it", await refuses(svc.room(JAMES, sales.id), 404));
    ok("a message reaches its chat's members live", emitted.some((e) => e.event === "chat.message" && e.users.includes(JAMES)));
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall team chat checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
