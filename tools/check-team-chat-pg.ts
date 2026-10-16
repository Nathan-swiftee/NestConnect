/**
 * Team Chat on real Postgres: the tenant-scoped store, and one workspace's chats
 * staying its own.
 *
 * Two workspaces each switch the module on and talk: a team chat, a direct chat
 * and a group. Acting as the second, nothing of the first's can be listed,
 * opened, read, written in, reacted to, quoted or joined — not through the
 * service and not through the store. Then what only Postgres can show: paging
 * back, mention flags in unread counts, files and stars kept, search, a deleted
 * team leaving its chat behind, and deleting a chat taking its messages (and
 * their stars) with it.
 *
 *     DATABASE_URL=… pnpm check:team-chat-pg
 */
import { PrismaClient } from "@prisma/client";
import { ChatService } from "../apps/api/src/chat/chat.service";
import { PrismaChatStore } from "../apps/api/src/chat/prisma-chat.store";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import type { NotificationsService } from "../apps/api/src/notifications/notifications.service";
import type { PushService } from "../apps/api/src/push/push.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { CHAT_PAGE_SIZE, sendChatMessageInputSchema } from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function refuses(p: () => Promise<unknown>): Promise<boolean> {
  try {
    await p();
    return false;
  } catch {
    return true;
  }
}
const violation = (p: Promise<unknown>) =>
  p.then(
    () => false,
    (e: Error) => e.name === "TenantViolationError",
  );
const say = (body: string, replyToId?: string) => sendChatMessageInputSchema.parse({ body, replyToId });

const A = "chatchk_a";
const B = "chatchk_b";

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [A, B];
  await root.notification.deleteMany({ where: { user: { orgId: { in: orgs } } } });
  await root.chatRoom.deleteMany({ where: { orgId: { in: orgs } } }); // members, messages, stars, audits cascade
  // The customer side, for the conversations each workspace shares.
  const convs = (await root.conversation.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((c) => c.id);
  const msgs = (await root.message.findMany({ where: { conversationId: { in: convs } }, select: { id: true } })).map((m) => m.id);
  await root.attachment.deleteMany({ where: { messageId: { in: msgs } } });
  await root.message.deleteMany({ where: { id: { in: msgs } } });
  await root.participant.deleteMany({ where: { conversationId: { in: convs } } });
  await root.assignmentEvent.deleteMany({ where: { conversationId: { in: convs } } });
  await root.conversation.deleteMany({ where: { id: { in: convs } } });
  const contacts = (await root.contact.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((c) => c.id);
  await root.contactIdentity.deleteMany({ where: { contactId: { in: contacts } } });
  await root.contact.deleteMany({ where: { id: { in: contacts } } });
  const inboxes = (await root.inbox.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((i) => i.id);
  await root.inboxTeam.deleteMany({ where: { inboxId: { in: inboxes } } });
  await root.inbox.deleteMany({ where: { id: { in: inboxes } } });
  await root.attachment.deleteMany({ where: { orgId: { in: orgs } } });
  await root.chatPresence.deleteMany({ where: { user: { orgId: { in: orgs } } } });
  await root.teamMember.deleteMany({ where: { team: { orgId: { in: orgs } } } });
  await root.team.deleteMany({ where: { orgId: { in: orgs } } });
  await root.session.deleteMany({ where: { user: { orgId: { in: orgs } } } });
  await root.user.deleteMany({ where: { orgId: { in: orgs } } });
  await root.appSetting.deleteMany({ where: { orgId: { in: orgs } } });
  await root.organization.deleteMany({ where: { id: { in: orgs } } });
}

async function main(): Promise<void> {
  const root = new PrismaClient();
  const store = new PrismaStore(root as unknown as PrismaService, new SecretEncryptionService());
  const chat = new PrismaChatStore(root as unknown as PrismaService);
  const realtime = {
    registerChat() {},
    emitToUsers() {},
    emitChatPresence() {},
    emitChatCue() {},
    onlineAmong: async () => new Set<string>(),
    isViewingChat: async () => false,
  } as unknown as RealtimeGateway;
  const push = { notify() {} } as unknown as PushService;
  // The real bell row, minus the socket and the phone.
  const notifications = {
    create: async (userId: string, n: { type: "chat_mention"; title: string; body?: string; chatRoomId?: string | null }) => {
      await store.createNotification({ userId, type: n.type, title: n.title, body: n.body, chatRoomId: n.chatRoomId });
    },
  } as unknown as NotificationsService;
  const svc = new ChatService(chat, store, realtime, push, notifications);
  await cleanup(root);
  for (const id of [A, B]) await root.organization.create({ data: { id, name: id } });

  const build = (org: string, tag: string) =>
    runInTenant(org, async () => {
      const team = await store.createTeam({ orgId: org, name: `${tag} support` });
      const make = (who: string, role: "admin" | "agent") =>
        store
          .createUser({ orgId: org, name: `${tag} ${who}`, email: `chatchk-${tag}-${who}@example.com`, role, teamIds: [team.id], password: "x-password-1" })
          .then((r) => r.user);
      const admin = await make("admin", "admin");
      const agent = await make("agent", "agent");
      await svc.setEnabled(admin.id, true);
      const teamRoom = (await svc.rooms(admin.id)).find((r) => r.kind === "team")!;
      const dm = await svc.openDirect(agent.id, admin.id);
      const secret = await svc.send(agent.id, dm.id, say(`${tag} secret`));
      const group = await svc.createGroup(admin.id, { name: `${tag} group`, memberIds: [agent.id] });
      const upload = await store.createUploadAttachment(org, { storageKey: `chatchk/${tag}.jpg`, kind: "image", mime: "image/jpeg", size: 10, filename: `${tag}.jpg` });
      await svc.star(agent.id, secret.id, true);
      // A customer conversation, shared into the team's chat.
      const wa = await store.createInbox({ orgId: org, type: "whatsapp", name: `${tag} WhatsApp`, handle: `chatchk-${tag}`, teamIds: [team.id], routingStrategy: "manual", channelConfig: {} });
      const contact = await store.upsertContactByIdentity({ orgId: org, kind: "phone", value: `+4470000000${tag === "a" ? 1 : 2}`, displayName: `${tag} customer` });
      const { conversation } = await store.findOrCreateOpenConversation({ orgId: org, inboxId: wa.id, contact, channel: "whatsapp" });
      const asked = (await store.appendInboundMessage(conversation.id, { authorName: contact.displayName, body: `${tag} wants 40 units`, channelMsgId: `wamid.chatchk_${tag}`, channel: "whatsapp" }))!;
      const card = await svc.share(admin.id, { roomId: teamRoom.id, conversationId: conversation.id, messageId: asked.id, body: "Stock?" });
      return { team, admin, agent, teamRoom, dm, secret, group, upload, conversation, asked, card };
    });

  try {
    const a = await build(A, "a");
    const b = await build(B, "b");

    console.log("\nOne workspace's chats are its own\n");
    await runInTenant(B, async () => {
      const mine = await svc.rooms(b.admin.id, true);
      ok("even an admin's 'all chats' is only B's", mine.every((r) => [b.teamRoom.id, b.dm.id, b.group.id].includes(r.id)) && mine.length === 3, mine.map((r) => r.name).join(", "));
      ok("A's direct chat can't be opened", await refuses(() => svc.room(b.admin.id, a.dm.id)));
      ok("or read", await refuses(() => svc.messages(b.admin.id, a.dm.id)));
      ok("or written in", await refuses(() => svc.send(b.admin.id, a.dm.id, say("hello"))));
      ok("A's message can't be reacted to", await refuses(() => svc.react(b.admin.id, a.secret.id, "👍")));
      ok("or deleted", await refuses(() => svc.remove(b.admin.id, a.secret.id)));
      ok("or asked about", await refuses(() => svc.info(b.admin.id, a.secret.id)));
      ok("or quoted into B's chat", await refuses(() => svc.send(b.admin.id, b.dm.id, say("look", a.secret.id))));
      ok("A's group can't be joined", await refuses(() => svc.addMembers(b.admin.id, a.group.id, { userIds: [b.agent.id] })));
      await svc.addMembers(b.admin.id, b.group.id, { userIds: [a.agent.id] });
      ok("A's person can't be added to B's group", (await svc.room(b.admin.id, b.group.id)).members.every((m) => m.id !== a.agent.id));
      ok("a direct chat with A's person can't be started", await refuses(() => svc.openDirect(b.admin.id, a.agent.id)));
      ok("not even through the store: a member", await violation(chat.upsertMember(a.group.id, b.agent.id)));
      ok("a message into A's chat", await violation(chat.createMessage({ roomId: a.dm.id, authorUserId: b.admin.id, kind: "text", body: "x", data: null, replyToId: null, mentions: [] })));
      ok("a reply quoting A's message", await violation(chat.createMessage({ roomId: b.dm.id, authorUserId: b.admin.id, kind: "text", body: "x", data: null, replyToId: a.secret.id, mentions: [] })));
      ok("A's person into B's chat", await violation(chat.upsertMember(b.group.id, a.agent.id)));
      ok("A's chat isn't there to get", (await chat.getRoom(a.dm.id)) === undefined && (await chat.getMessage(a.secret.id)) === undefined);
      ok("or its members to list", (await chat.listMembers(a.dm.id)).length === 0);
      ok("or its messages", (await chat.listMessages(a.dm.id, { limit: 10 })).length === 0);
      ok("A's message can't be starred", await refuses(() => svc.star(b.admin.id, a.secret.id, true)));
      ok("or starred through the store", await violation(chat.setStar(b.admin.id, a.secret.id, true)));
      ok("search doesn't reach A", (await svc.search(b.admin.id, "secret")).every((h) => h.roomId !== a.dm.id));
      ok("not even asked for A's chat by name", (await chat.searchMessages([a.dm.id], "secret", 10)).length === 0);
      ok("A's starred messages aren't B's to list", (await chat.starsOf(a.agent.id)).length === 0);
      ok("A's upload can't be sent in B", await refuses(() => svc.send(b.agent.id, b.dm.id, sendChatMessageInputSchema.parse({ body: "", attachments: [a.upload] }))));
      ok("A's conversation can't be shared into B's chat", await refuses(() => svc.share(b.admin.id, { roomId: b.teamRoom.id, conversationId: a.conversation.id, body: "" })));
      ok("nor quoted from, with B's own conversation", await refuses(() => svc.share(b.admin.id, { roomId: b.teamRoom.id, conversationId: b.conversation.id, messageId: a.asked.id, body: "" })));
      ok("nor linked through the store", await violation(chat.createMessage({ roomId: b.teamRoom.id, authorUserId: b.admin.id, kind: "text", body: "x", data: null, replyToId: null, mentions: [], conversationId: a.conversation.id })));
      ok("A's discussions aren't B's to list", (await svc.discussions(b.admin.id, a.conversation.id)).length === 0 && (await chat.sharesOf(a.conversation.id)).length === 0);
      ok("nor A's card to open", await refuses(() => svc.thread(b.admin.id, a.card.id)));
      ok("switching B off", (await svc.setEnabled(b.admin.id, false)).enabled === false);
    });
    await runInTenant(A, async () => {
      ok("leaves A on", (await svc.status(a.admin.id)).enabled);
      ok("and A's chat as it was", (await svc.messages(a.admin.id, a.dm.id)).messages.some((m) => m.body === "a secret"));
    });

    console.log("\nWhat the store does\n");
    await runInTenant(A, async () => {
      for (let i = 0; i < CHAT_PAGE_SIZE + 5; i++) await svc.send(a.admin.id, a.group.id, say(`line ${i}`));
      const first = await svc.messages(a.agent.id, a.group.id);
      ok("a page is the newest, oldest first", first.messages.length === CHAT_PAGE_SIZE && first.hasMore && first.messages.at(-1)!.body === `line ${CHAT_PAGE_SIZE + 4}`);
      const back = await svc.messages(a.agent.id, a.group.id, first.messages[0]!.id);
      ok("scrolling back picks up exactly where it left off", back.messages.at(-1)!.body === "line 4" && !back.hasMore && back.messages.some((m) => m.system));
      const list = await svc.rooms(a.agent.id);
      ok("unread counts every message from others", list.find((r) => r.id === a.group.id)?.unread === CHAT_PAGE_SIZE + 5);
      ok("no mention, no flag", list.find((r) => r.id === a.group.id)?.mentioned === false);
      await svc.send(a.admin.id, a.group.id, say("@chatchk-a-agent over to you"));
      const flagged = (await svc.rooms(a.agent.id)).find((r) => r.id === a.group.id);
      ok("a mention flags the chat", flagged?.mentioned === true);
      const bell = await store.listNotifications(a.agent.id);
      ok("and lands in the bell, opening the chat", bell[0]?.type === "chat_mention" && bell[0]?.chatRoomId === a.group.id);
      await svc.read(a.agent.id, a.group.id);
      ok("reading clears both", (await svc.rooms(a.agent.id)).find((r) => r.id === a.group.id)?.unread === 0);

      const photo = await svc.send(a.agent.id, a.dm.id, sendChatMessageInputSchema.parse({ body: "the van", attachments: [a.upload] }));
      const kept = (await svc.messages(a.admin.id, a.dm.id)).messages.find((m) => m.id === photo.id);
      ok("a photo is kept with its message", kept?.attachments[0]?.id === a.upload.id && kept.attachments[0]!.filename === "a.jpg");
      await chat.updateMessage(photo.id, { link: { url: "https://x.co", title: "X", description: null, siteName: "x.co" } });
      ok("and a link card", (await chat.getMessage(photo.id))?.link?.title === "X");
      await chat.updateMessage(photo.id, { link: null });
      ok("which can be taken off again", (await chat.getMessage(photo.id))?.link === null);
      const hits = await svc.search(a.admin.id, "SECRET");
      ok("search ignores case, and says where", hits.length === 1 && hits[0]!.message.id === a.secret.id && hits[0]!.roomKind === "direct");
      ok("the agent's star survived", (await svc.starred(a.agent.id))[0]?.message.id === a.secret.id);
      await svc.star(a.agent.id, a.secret.id, true);
      ok("starring twice is still one star", (await chat.starsOf(a.agent.id)).length === 1);
      await svc.remove(a.agent.id, a.secret.id);
      ok("a deleted message drops out of starred", (await svc.starred(a.agent.id)).length === 0);

      const talk = await svc.discussions(a.agent.id, a.conversation.id);
      ok("a shared conversation knows where it's discussed", talk.length === 1 && talk[0]!.card.shared?.quote?.body === "a wants 40 units" && talk[0]!.card.shared.status === "open");
      await svc.send(a.agent.id, a.teamRoom.id, say("40 in stock", a.card.id));
      await store.setStatus(a.conversation.id, "closed");
      const after = await svc.discussions(a.agent.id, a.conversation.id);
      ok("the replies are counted, and the card follows the conversation", after[0]!.replies === 1 && after[0]!.card.shared?.status === "closed");
      ok("and its log says so", (await store.listConversationEvents(a.conversation.id)).some((e) => e.type === "shared_to_chat"));
      await root.message.deleteMany({ where: { conversationId: a.conversation.id } });
      await root.participant.deleteMany({ where: { conversationId: a.conversation.id } });
      await root.conversation.delete({ where: { id: a.conversation.id } });
      const gone = (await svc.thread(a.agent.id, a.card.id)).card.shared;
      ok("a deleted conversation leaves its card, saying it's gone", !!gone && gone.status === null && gone.contactName === "a customer");

      await store.deleteTeam(a.team.id);
      const room = await chat.getRoom(a.teamRoom.id);
      ok("deleting the team leaves its chat, detached", !!room && room.teamId === null && room.kind === "team");
      const archived = (await svc.rooms(a.admin.id, true)).find((r) => r.id === a.teamRoom.id);
      ok("archived, for admins to read", archived?.archived === true && !archived.isMember, JSON.stringify(archived && { a: archived.archived, m: archived.isMember }));

      await root.chatRoom.delete({ where: { id: a.group.id } });
      ok("deleting a chat takes its messages and members", (await root.chatMessage.count({ where: { roomId: a.group.id } })) === 0 && (await root.chatMember.count({ where: { roomId: a.group.id } })) === 0);
      await root.chatRoom.delete({ where: { id: a.dm.id } });
      ok("its stars go with it", (await root.chatStar.count({ where: { chatMessageId: a.secret.id } })) === 0);
      ok("and the bell entries pointing at it", (await root.notification.count({ where: { chatRoomId: a.group.id } })) === 0);
    });
  } finally {
    await cleanup(root);
    await root.$disconnect();
  }

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall team chat Postgres checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
