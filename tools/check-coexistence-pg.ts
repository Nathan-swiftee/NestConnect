/**
 * The WhatsApp Business app history import on real Postgres: batches arriving
 * newest first are filed in date order, a repeat adds nothing, the history
 * conversation is closed and read, phone replies are stored labelled — and one
 * workspace's import never touches another's.
 *
 *     DATABASE_URL=… pnpm check:coexistence-pg
 */
import { PrismaClient } from "@prisma/client";
import { PrismaStore } from "../apps/api/src/data/prisma.store";
import type { PrismaService } from "../apps/api/src/data/prisma.service";
import { SecretEncryptionService } from "../apps/api/src/crypto/secret-encryption.service";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const A = "coexchk_a";
const B = "coexchk_b";

async function cleanup(root: PrismaClient): Promise<void> {
  const orgs = [A, B];
  await root.message.deleteMany({ where: { conversation: { orgId: { in: orgs } } } });
  await root.conversation.deleteMany({ where: { orgId: { in: orgs } } });
  await root.contactIdentity.deleteMany({ where: { contact: { orgId: { in: orgs } } } }).catch(() => undefined);
  await root.contact.deleteMany({ where: { orgId: { in: orgs } } });
  await root.inboxTeam.deleteMany({ where: { inbox: { orgId: { in: orgs } } } });
  await root.inbox.deleteMany({ where: { orgId: { in: orgs } } });
  await root.organization.deleteMany({ where: { id: { in: orgs } } });
}

async function main(): Promise<void> {
  const root = new PrismaClient();
  const store = new PrismaStore(root as unknown as PrismaService, new SecretEncryptionService());
  await cleanup(root);
  for (const id of [A, B]) await root.organization.create({ data: { id, name: id } });

  try {
    const a = await runInTenant(A, async () => {
      const inbox = await store.createInbox({ orgId: A, type: "whatsapp", name: "A app", handle: "coexchk_a_pn", teamIds: [], routingStrategy: "manual", channelConfig: { phoneNumberId: "coexchk_a_pn", accessToken: "t", wabaId: "coexchk_a_waba", coexistence: "true" } });
      const contact = await store.upsertContactByIdentity({ orgId: A, kind: "wa_id", value: "447700900901", displayName: "447700900901" });
      return { inbox, contact };
    });

    console.log("\nHistory\n");
    await runInTenant(A, async () => {
      const at = (iso: string) => new Date(iso);
      const first = await store.importWhatsAppHistory({
        orgId: A, inboxId: a.inbox.id, contactId: a.contact.id,
        messages: [
          { direction: "in", authorName: "Ruth", body: "Thanks!", channelMsgId: "coexchk.h3", sentAt: at("2026-10-01T12:00:00Z") },
          { direction: "out", authorName: "WhatsApp Business app", body: "On its way", channelMsgId: "coexchk.h2", sentAt: at("2026-10-01T11:00:00Z") },
        ],
      });
      const second = await store.importWhatsAppHistory({
        orgId: A, inboxId: a.inbox.id, contactId: a.contact.id,
        messages: [
          { direction: "in", authorName: "Ruth", body: "Where's my order?", channelMsgId: "coexchk.h1", sentAt: at("2026-09-30T09:00:00Z") },
          { direction: "in", authorName: "Ruth", body: "Thanks!", channelMsgId: "coexchk.h3", sentAt: at("2026-10-01T12:00:00Z") },
        ],
      });
      ok("one history conversation for the customer", first.conversationId === second.conversationId);
      ok("a message seen before is skipped", first.added === 2 && second.added === 1, `${first.added} ${second.added}`);
      const conv = (await store.getConversation(first.conversationId))!;
      ok("filed in date order", conv.messages.map((m) => m.body).join(" | ") === "Where's my order? | On its way | Thanks!", conv.messages.map((m) => `${m.seq}:${m.body}`).join(" | "));
      ok("numbered in that order", conv.messages.map((m) => m.seq).join() === "1,2,3");
      ok("closed and read", conv.status === "closed" && !conv.unread);
      ok("its last activity is the newest message", conv.lastActivityAt.startsWith("2026-10-01T12:00"), conv.lastActivityAt);
      const page = await store.listMessages(first.conversationId, { limit: 2 });
      ok("paging back through it works", page.items.map((m) => m.body).join(" | ") === "On its way | Thanks!" && !!page.nextCursor);

      console.log("\nA reply from the phone\n");
      const { conversation: live } = await store.findOrCreateOpenConversation({ orgId: A, inboxId: a.inbox.id, contact: a.contact, channel: "whatsapp" });
      ok("a live conversation is separate from the closed history", live.id !== first.conversationId);
      const echo = await store.appendSyncedOutbound(live.id, { body: "See you at 9", channelMsgId: "coexchk.e1", authorName: "WhatsApp Business app", channel: "whatsapp", markRead: true });
      ok("stored as an outbound WhatsApp message, labelled", echo?.direction === "out" && echo.channel === "whatsapp" && echo.authorName === "WhatsApp Business app");
      ok("and findable by its WhatsApp id", (await store.getMessageRefByChannelId("coexchk.e1"))?.conversationId === live.id);
    });

    console.log("\nOne workspace's history is its own\n");
    await runInTenant(B, async () => {
      ok("B can't find A's channel by its account", (await store.getInboxesByWabaId("coexchk_a_waba")).every((i) => i.orgId === A));
      ok("nor A's messages by their ids", (await store.getMessageRefByChannelId("coexchk.h1")) === undefined);
    });
  } finally {
    await cleanup(root);
    await root.$disconnect();
  }

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall coexistence Postgres checks passed\n");
  process.exit(failed ? 1 : 0);
}

void main();
