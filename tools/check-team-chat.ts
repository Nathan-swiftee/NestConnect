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
 *   H  admins and managers open any chat and can write in it without joining; each look is recorded;
 *   I  pinned chats first; a deleted team's chat stays, read-only;
 *   J  photos, voice notes and files (only this workspace's uploads, described
 *      by the server's own record); link cards, fetched safely; search only
 *      where you can read; stars are yours alone;
 *   K  a customer conversation discussed: its card (and the message it came
 *      from), live status, the bar back on the thread, the replies, the log.
 *
 * (One workspace not seeing another's chats is proven on Postgres, in
 * check-tenant-isolation.)
 *
 *     pnpm check:team-chat
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ChatService } from "../apps/api/src/chat/chat.service";
import { LinkPreviewService, firstLink, isPublicAddress, parsePreview } from "../apps/api/src/chat/link-preview";
import { renderConversationEvents } from "../apps/api/src/conversations/conversation-log";
import { MemoryChatStore } from "../apps/api/src/chat/memory-chat.store";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import type { PushRequest, PushService } from "../apps/api/src/push/push.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { chatAttachmentLabel, chatSystemText, chatTicks, sendChatMessageInputSchema, type Attachment, type ChatRoomSummary } from "../packages/schemas/src";

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
const withFiles = (body: string, attachments: Attachment[]) => sendChatMessageInputSchema.parse({ body, attachments });
async function until(cond: () => Promise<boolean>, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}
/** A page to preview, and one that redirects inward. */
function pages(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/away") {
      res.writeHead(302, { location: "http://127.0.0.1:1/private" });
      res.end();
      return;
    }
    if (req.url === "/file.zip") {
      res.writeHead(200, { "content-type": "application/zip" });
      res.end("PK");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<html><head><title>Fallback</title><meta property="og:title" content="Rota &amp; shifts"><meta property="og:description" content="Who is on this week"><meta property="og:site_name" content="Nest Docs"></head></html>');
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}
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
  const links = new LinkPreviewService();
  links.allowPrivate = true; // the test pages are on localhost
  const svc = new ChatService(new MemoryChatStore(), store, realtime, push, notifications, links);
  const { server, base } = await pages();

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

    console.log("\nH — admins and managers oversee\n");
    const all = await svc.rooms(NATHAN, true);
    const theirs = all.find((x) => x.id === dm.id);
    ok("an admin's 'all chats' includes other people's direct chats", !!theirs && theirs.isMember === false && theirs.name === "James & Amara", theirs?.name);
    const amaraAll = await svc.rooms(AMARA, true);
    ok("an agent asking for all gets only their own", amaraAll.every((x) => x.isMember) && !amaraAll.some((x) => x.id === support.id));
    const peek = await svc.room(NATHAN, dm.id);
    ok("an admin opens it, and may write in it", peek.oversight && peek.canPost && peek.myRole === null);
    pushes.length = 0;
    const steppedIn = await svc.send(NATHAN, dm.id, say("Quick one from me"));
    ok("what they write is theirs", steppedIn.author?.id === NATHAN && steppedIn.body === "Quick one from me");
    ok("and both people in the chat hear it", pushes[0]?.userIds.slice().sort().join() === [JAMES, AMARA].sort().join() && pushes[0]?.title === "Nathan A", JSON.stringify(pushes[0] && { u: pushes[0].userIds, t: pushes[0].title }));
    const stillTwo = await svc.room(JAMES, dm.id);
    ok("without joining it: still the two of them", stillTwo.memberCount === 2 && stillTwo.name === "Amara" && !(await svc.room(NATHAN, dm.id)).isMember, `${stillTwo.memberCount} ${stillTwo.name}`);
    ok("and can react", (await svc.react(NATHAN, reply.id, "👍")).reactions.some((r) => r.emoji === "👍"));
    ok("but can't file a customer thread there", await refuses(svc.share(NATHAN, { roomId: dm.id, conversationId: "conv_1", body: "" }), 403));
    const { user: mgr } = await store.createUser({ orgId: ORG_ID, name: "Mo Manager", email: "mo@example.com", role: "manager", teamIds: [] });
    ok("a manager has the eye too", (await svc.status(mgr.id)).canOversee && (await svc.rooms(mgr.id, true)).some((x) => x.id === dm.id));
    ok("and can write in a chat they're not in", (await svc.send(mgr.id, dm.id, say("Me too"))).author?.id === mgr.id);
    const private_ = await svc.createGroup(mgr.id, { name: "Managers", memberIds: [AMARA] });
    ok("an agent can't open a chat they're not in", await refuses(svc.room(JAMES, private_.id), 404));
    ok("…or write in it", await refuses(svc.send(JAMES, private_.id, say("hi")), 404));
    await svc.room(NATHAN, dm.id);
    const looks = await svc.audits(NATHAN, dm.id);
    ok("the look is recorded, once for a quick re-open", looks.filter((l) => l.person.id === NATHAN).length === 1);
    ok("only admins and managers see that record", await refuses(svc.audits(JAMES, dm.id), 403));
    ok("an admin reading along gets no unread counts or delivered ticks", (await svc.room(NATHAN, dm.id)).unread === 0);

    console.log("\nI — the list, and deleted teams\n");
    await svc.setPrefs(JAMES, ops.id, { pinned: true });
    ok("pinned first", (await svc.rooms(JAMES))[0]?.id === ops.id);
    await svc.setPrefs(JAMES, ops.id, { pinned: false });
    // Having opened it leaves a row of read markers behind; that mustn't keep anyone in it.
    await svc.room(NATHAN, sales.id);
    await store.deleteTeam("team_sales");
    ok("a deleted team's chat leaves everyone's list", !(await svc.rooms(NATHAN)).some((x) => x.id === sales.id));
    const old = (await svc.rooms(NATHAN, true)).find((x) => x.id === sales.id);
    ok("but is kept, archived, for admins to read", !!old?.archived && !old.isMember && old.name === "Sales team", `${old?.name} ${old?.archived}`);
    ok("its messages are still there", (await svc.messages(NATHAN, sales.id)).messages.some((m) => m.body === "Hi Sales 👋"));
    ok("and nobody can write in it", await refuses(svc.send(NATHAN, sales.id, say("anyone?")), 403));
    ok("an agent can't open it", await refuses(svc.room(JAMES, sales.id), 404));
    ok("a message reaches its chat's members live", emitted.some((e) => e.event === "chat.message" && e.users.includes(JAMES)));

    console.log("\nJ — files, links, search and stars\n");
    const photo = await store.createUploadAttachment(ORG_ID, { storageKey: "k1", kind: "image", mime: "image/jpeg", size: 2048, filename: "van.jpg", width: 800, height: 600 });
    const voice = await store.createUploadAttachment(ORG_ID, { storageKey: "k2", kind: "voice", mime: "audio/webm", size: 900, filename: "voice.webm", durationMs: 12_000, waveform: [0.2, 0.8] });
    const pic = await svc.send(JAMES, support.id, withFiles("", [{ ...photo, mime: "text/html", filename: "evil.html", url: "https://evil.example/x" }]));
    ok("a photo on its own is a message", pic.body === "" && pic.attachments.length === 1);
    ok("what it is comes from the upload, not from what the app said", pic.attachments[0]!.mime === "image/jpeg" && pic.attachments[0]!.filename === "van.jpg" && pic.attachments[0]!.url === `/api/media/${photo.id}`);
    ok("and keeps its size for the bubble", pic.attachments[0]!.width === 800 && pic.attachments[0]!.height === 600);
    ok("a file that was never uploaded is refused", await refuses(svc.send(JAMES, support.id, withFiles("", [{ ...photo, id: "att_nope" }])), 400));
    ok("nothing at all is refused", !sendChatMessageInputSchema.safeParse({ body: "  " }).success && !sendChatMessageInputSchema.safeParse({ body: "" }).success);
    ok("ten files at most", !sendChatMessageInputSchema.safeParse({ body: "", attachments: Array.from({ length: 11 }, () => photo) }).success);
    pushes.length = 0;
    const note = await svc.send(JAMES, support.id, withFiles("", [voice]));
    ok("a voice note keeps its length and waveform", note.attachments[0]!.durationMs === 12_000 && note.attachments[0]!.waveform?.length === 2);
    ok("its push says what it is", pushes[0]?.body === "James: 🎤 Voice message (0:12)", pushes[0]?.body);
    ok("the list's last message says so too", chatAttachmentLabel((await svc.rooms(NATHAN)).find((x) => x.id === support.id)!.lastMessage!.attachments) === "🎤 Voice message (0:12)");
    ok("labels for the rest", chatAttachmentLabel([photo, photo]) === "📷 2 photos" && chatAttachmentLabel([{ kind: "file", filename: "rota.pdf" }]) === "📄 rota.pdf");
    const deletedPic = await svc.remove(JAMES, pic.id);
    ok("deleting it takes the file off the message", deletedPic.attachments.length === 0);

    ok("the link in a message", firstLink("see https://nest.example/rota.") === "https://nest.example/rota" && firstLink("no link here") === null);
    const linked = await svc.send(NATHAN, support.id, say(`Rota for next week ${base}/rota`));
    ok("sent at once — the card follows", linked.link === null);
    const card = await until(async () => !!(await svc.messages(NATHAN, support.id)).messages.find((m) => m.id === linked.id)?.link);
    const got = (await svc.messages(JAMES, support.id)).messages.find((m) => m.id === linked.id)?.link;
    ok("with the page's own title and description", card && got?.title === "Rota & shifts" && got.description === "Who is on this week" && got.siteName === "Nest Docs", JSON.stringify(got));
    ok("and everyone's told it changed", emitted.some((e) => e.event === "chat.message.updated" && e.users.includes(JAMES)));
    const noLink = await svc.edit(NATHAN, linked.id, "Rota for next week — in the drive");
    ok("edit the link out, and the card goes", noLink.link === null);
    ok("a page's <title> will do", parsePreview("<title>Just a title</title>", "https://www.x.co/a")?.title === "Just a title" && parsePreview("<title>t</title>", "https://www.x.co/a")?.siteName === "x.co");
    ok("no title, no card", parsePreview("<p>hi</p>", "https://x.co") === null);

    const careful = new LinkPreviewService();
    ok("never this machine", (await careful.preview(`${base}/rota`)) === null && (await careful.preview("http://localhost/")) === null);
    ok("nor the cloud's metadata address", (await careful.preview("http://169.254.169.254/latest/meta-data/")) === null);
    ok("nor the private network", !isPublicAddress("10.1.2.3") && !isPublicAddress("192.168.0.4") && !isPublicAddress("172.20.0.1") && !isPublicAddress("::1") && !isPublicAddress("fd00::1") && !isPublicAddress("::ffff:127.0.0.1") && !isPublicAddress("::ffff:7f00:1"));
    ok("while the internet is fine", isPublicAddress("93.184.216.34") && isPublicAddress("2606:2800:220:1::1"));
    ok("nor other schemes, ports or passwords", (await careful.preview("file:///etc/passwd")) === null && (await careful.preview("http://example.com:8080/")) === null && (await careful.preview("http://u:p@example.com/")) === null);
    ok("a redirect inward is followed into nothing", (await links.preview(`${base}/away`)) === null);
    ok("and only web pages are read", (await links.preview(`${base}/file.zip`)) === null);

    await svc.send(JAMES, ops.id, say("The van keys are in the drawer"));
    await svc.send(NATHAN, support.id, say("Has anyone seen the VAN keys?"));
    const found = await svc.search(JAMES, "van keys");
    ok("search finds it in every chat you're in, newest first", found.length === 2 && found[0]!.roomName === "Support team" && found[1]!.roomName === "Ops & Dispatch", found.map((h) => h.roomName).join(", "));
    ok("and not in chats you're not in", (await svc.search(AMARA, "van keys")).length === 0);
    ok("nor from before they joined", (await svc.search(JAMES, "Before James joins")).length === 0);
    ok("one letter isn't a search", (await svc.search(JAMES, "v")).length === 0);
    ok("deleted messages aren't found", (await svc.search(JAMES, "got a minute")).length === 0);

    const keys = found[0]!.message;
    await svc.star(JAMES, keys.id, true);
    await svc.star(JAMES, found[1]!.message.id, true);
    const stars = await svc.starred(JAMES);
    ok("starred, newest star first, with where it was said", stars.length === 2 && stars[0]!.message.id === found[1]!.message.id && stars[1]!.roomName === "Support team");
    ok("stars are mine alone", (await svc.starred(NATHAN)).length === 0);
    await svc.star(JAMES, keys.id, false);
    ok("unstarred", (await svc.starred(JAMES)).length === 1);
    ok("you can't star what you can't read", await refuses(svc.star(AMARA, keys.id, true), 404));
    const before = (await svc.messages(NATHAN, ops.id)).messages.find((m) => m.body === "Before James joins");
    ok("including from before you joined", !!before && (await refuses(svc.star(JAMES, before.id, true), 404)));
    await svc.leave(JAMES, ops.id);
    ok("leave the chat, and its stars go quiet", (await svc.starred(JAMES)).length === 0);

    console.log("\nK — customer conversations, discussed\n");
    const conv = (await store.getConversation("conv_north"))!;
    const first = conv.messages[0]!;
    const share = (roomId: string, body = "", messageId?: string) => ({ roomId, conversationId: conv.id, body, messageId: messageId ?? null });
    pushes.length = 0;
    const cardMsg = await svc.share(NATHAN, share(support.id, "Can someone check the VAT on this?", first.id));
    ok("the card says who, where and what", cardMsg.shared?.contactName === "Northside Logistics" && cardMsg.shared.channel === "whatsapp" && cardMsg.shared.status === "open");
    ok("with the message it was shared from", cardMsg.shared?.quote?.messageId === first.id && cardMsg.shared.quote.authorName === "Northside Logistics" && cardMsg.shared.quote.body.startsWith("Hi team"));
    ok("and the line that goes with it", cardMsg.body === "Can someone check the VAT on this?");
    ok("everyone else in the chat hears about it", pushes[0]?.userIds.join() === JAMES && pushes[0]?.body === "Nathan A: Can someone check the VAT on this?");
    pushes.length = 0;
    const bare = await svc.share(NATHAN, share(support.id));
    ok("shared on its own, it reads as the customer", pushes[0]?.body === "Nathan A: 💬 Northside Logistics" && bare.shared?.quote === null);
    ok("not into a chat you aren't in", await refuses(svc.share(AMARA, share(support.id)), 404));
    ok("nor one you're only reading as an admin", await refuses(svc.share(NATHAN, share(dm.id)), 403));
    ok("nor a conversation that isn't there", await refuses(svc.share(NATHAN, { ...share(support.id), conversationId: "conv_nope" }), 404));
    ok("nor a message from another conversation", await refuses(svc.share(NATHAN, share(support.id, "", "msg_nope")), 404));

    const rows = await store.listConversationEvents(conv.id);
    const people = new Map((await store.listMembers()).map((m) => [m.user.id, m.user]));
    const log = renderConversationEvents(rows, people, new Map()).filter((e) => e.type === "shared_to_chat");
    ok("the thread's log says where it went", log.some((e) => e.text === "Nathan A shared it with Support team" && e.detail === "One message · “Can someone check the VAT on this?”"), log.map((e) => `${e.text} | ${e.detail}`).join(" / "));
    await svc.share(JAMES, share(dm.id, "Seen this one?"));
    const log2 = renderConversationEvents(await store.listConversationEvents(conv.id), people, new Map()).filter((e) => e.type === "shared_to_chat");
    ok("a direct chat is named by the person", log2.some((e) => e.text === "James shared it with Amara"), log2.map((e) => e.text).join(" / "));

    let found2 = await svc.discussions(JAMES, conv.id);
    ok("the thread knows where it's discussed", found2.length === 3 && found2.every((d) => d.card.shared?.conversationId === conv.id), String(found2.length));
    await svc.send(JAMES, support.id, say("Zero-rated is right, I'll reissue it", cardMsg.id));
    found2 = await svc.discussions(JAMES, conv.id);
    const here = found2.find((d) => d.card.id === cardMsg.id)!;
    ok("with the replies to each card, newest discussion first", found2[0]!.card.id === cardMsg.id && here.replies === 1 && here.latest?.body === "Zero-rated is right, I'll reissue it" && here.roomName === "Support team" && here.canPost);
    ok("only in chats you're in", (await svc.discussions(AMARA, conv.id)).map((d) => d.roomKind).join() === "direct");
    ok("an admin isn't shown other people's direct chats about it", !(await svc.discussions(NATHAN, conv.id)).some((d) => d.roomKind === "direct"));
    const t = await svc.thread(NATHAN, cardMsg.id);
    const toBare = await svc.send(JAMES, support.id, say("On it", bare.id));
    ok("a reply to a card with nothing written quotes the customer", toBare.replyTo?.body === "💬 Northside Logistics", toBare.replyTo?.body);
    ok("a discussion in full: the card and what was said to it", t.card.id === cardMsg.id && t.replies.length === 1 && t.replies[0]!.replyTo?.id === cardMsg.id);
    ok("somebody not in the chat can't open it", await refuses(svc.thread(AMARA, cardMsg.id), 404));
    ok("an ordinary message isn't a discussion", await refuses(svc.thread(NATHAN, t.replies[0]!.id), 404));

    await store.setStatus(conv.id, "closed");
    await store.assign(conv.id, { assigneeUserId: AMARA });
    const fresh = (await svc.messages(JAMES, support.id)).messages.find((m) => m.id === cardMsg.id)!;
    ok("the card follows the conversation: closed, and Amara has it", fresh.shared?.status === "closed" && fresh.shared.assigneeName === "Amara", JSON.stringify(fresh.shared && { s: fresh.shared.status, a: fresh.shared.assigneeName }));
    ok("…in the discussion too", (await svc.discussions(JAMES, conv.id))[0]!.card.shared?.status === "closed");
    await svc.remove(NATHAN, bare.id);
    ok("deleting a card takes it out of the discussions", (await svc.discussions(NATHAN, conv.id)).every((d) => d.card.id !== bare.id));
    ok("and leaves no card behind", (await svc.messages(NATHAN, support.id)).messages.find((m) => m.id === bare.id)?.shared === null);
    ok("a chat list says what was shared", (await svc.rooms(AMARA)).find((r) => r.id === dm.id)?.lastMessage?.shared?.contactName === "Northside Logistics");
  });
  server.close();

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall team chat checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
