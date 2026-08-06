/**
 * Starter seed for the Postgres path. Idempotent (upserts by id), and aligned
 * with the in-memory fixtures so the DB-backed app looks identical to the
 * zero-infra demo. Run: `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ORG = "org_swiftee";
// Dev password shared by all seeded users. Change via AUTH_DEV_PASSWORD.
const passwordHash = bcrypt.hashSync(process.env.AUTH_DEV_PASSWORD ?? "ding1234", 8);

// Demo timestamps relative to real "now" so the seeded thread stays fresh and
// its date dividers roll over (2 days ago / Yesterday / Today) like WhatsApp.
// The message seed below re-runs on every deploy, so these stay current.
const now = Date.now();
const mins = (m: number) => new Date(now - m * 60_000);
const dayAt = (d: number, hh: number, mm: number) => {
  const t = new Date(now);
  t.setHours(hh, mm, 0, 0);
  t.setDate(t.getDate() - d);
  return t;
};

async function main() {
  await prisma.organization.upsert({
    where: { id: ORG },
    update: {},
    create: { id: ORG, name: "Swiftee", region: "uk" },
  });

  const users = [
    { id: "usr_nathan", name: "Nathan A", email: "nathan@swiftee.co.uk", role: "admin" as const, avatarColor: "linear-gradient(135deg,#3B82F6,#8B5CF6)", online: true },
    { id: "usr_james", name: "James", email: "james@swiftee.co.uk", role: "agent" as const, avatarColor: "linear-gradient(135deg,#0EA5E9,#22D3EE)", online: true },
    { id: "usr_amara", name: "Amara", email: "amara@swiftee.co.uk", role: "agent" as const, avatarColor: "linear-gradient(135deg,#F43F5E,#F59E0B)", online: false },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { passwordHash },
      create: { orgId: ORG, passwordHash, ...u },
    });
  }

  const teams = [
    { id: "team_support", name: "Support team", icon: "headset", order: 0, slaMinutes: 60 },
    { id: "team_sales", name: "Sales team", icon: "cart", order: 1, slaMinutes: 240 },
  ];
  for (const t of teams) {
    await prisma.team.upsert({
      where: { id: t.id },
      update: { slaMinutes: t.slaMinutes },
      create: { orgId: ORG, ...t },
    });
  }

  const memberships = [
    { userId: "usr_nathan", teamId: "team_support", role: "manager" },
    { userId: "usr_nathan", teamId: "team_sales", role: "manager" },
    { userId: "usr_james", teamId: "team_support", role: "member" },
    { userId: "usr_amara", teamId: "team_sales", role: "member" },
  ];
  for (const m of memberships) {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: m.userId, teamId: m.teamId } },
      update: {},
      create: m,
    });
  }

  const inboxes = [
    { id: "inbox_wa", type: "whatsapp" as const, name: "+44 20 7946", handle: "+44 20 7946 0100", routing: "manual" as const, teams: ["team_support"] },
    { id: "inbox_support", type: "email" as const, name: "support@swiftee.co.uk", handle: "support@swiftee.co.uk", routing: "round_robin" as const, teams: ["team_support"] },
    { id: "inbox_hello", type: "email" as const, name: "hello@swiftee.co.uk", handle: "hello@swiftee.co.uk", routing: "round_robin" as const, teams: ["team_sales"] },
  ];
  for (const i of inboxes) {
    await prisma.inbox.upsert({
      where: { id: i.id },
      update: {},
      create: { id: i.id, orgId: ORG, type: i.type, name: i.name, handle: i.handle, routingStrategy: i.routing },
    });
    for (const teamId of i.teams) {
      await prisma.inboxTeam.upsert({
        where: { inboxId_teamId: { inboxId: i.id, teamId } },
        update: {},
        create: { inboxId: i.id, teamId },
      });
    }
  }

  // Legacy fix: a WhatsApp group used to get its own `whatsapp_group` inbox.
  // Groups now live under their WhatsApp number, so move any conversations off
  // a legacy group inbox onto the number and drop the standalone inbox. Runs
  // every deploy; a no-op once migrated.
  const legacyGroupInboxes = await prisma.inbox.findMany({ where: { orgId: ORG, type: "whatsapp_group" } });
  for (const gi of legacyGroupInboxes) {
    await prisma.conversation.updateMany({ where: { inboxId: gi.id }, data: { inboxId: "inbox_wa" } });
    await prisma.inboxTeam.deleteMany({ where: { inboxId: gi.id } });
    await prisma.inbox.delete({ where: { id: gi.id } });
  }

  const labels = [
    { id: "lbl_vip", name: "VIP", color: "#0FA47A" },
    { id: "lbl_delivery", name: "Delivery", color: "#E68A00" },
    { id: "lbl_billing", name: "Billing", color: "#5B8DEF" },
    { id: "lbl_order", name: "Order", color: "#0FA47A" },
    { id: "lbl_onboarding", name: "Onboarding", color: "#A06CF2" },
  ];
  for (const l of labels) {
    await prisma.label.upsert({ where: { id: l.id }, update: {}, create: { orgId: ORG, ...l } });
  }

  // A representative set of contacts + conversations + messages.
  const seedConversations = [
    {
      contact: { id: "ct_ivy", displayName: "The Ivy House", company: "Venue · Bristol", avatarColor: "linear-gradient(135deg,#F97316,#DB2777)", phone: "+44 117 496 0122", email: "ops@theivyhouse.co.uk", tags: ["Key account", "Events"] },
      conv: { id: "conv_ivy", inboxId: "inbox_wa", channel: "whatsapp_group" as const, subject: null as string | null, status: "open" as const, assigneeUserId: "usr_nathan", assignedTeamId: "team_support", priority: "high" as const, unread: true, unreadCount: 2, slaDueAt: mins(-72), preview: "James · Swiftee: 5pm works — re-slotting now 👍" },
      labels: ["lbl_vip", "lbl_delivery"],
      // Spans 2 days ago → yesterday → today so the date dividers roll over.
      messages: [
        { direction: "in" as const, authorType: "contact" as const, authorName: "Priya (The Ivy House)", body: "Morning! Are we still on for the linen drop this week?", internal: false, createdAt: dayAt(2, 9, 2) },
        { direction: "out" as const, authorType: "user" as const, authorName: "Nathan A", authorUserId: "usr_nathan", body: "Morning Priya 👋 Yes — you're booked in. I'll confirm the slot shortly.", internal: false, createdAt: dayAt(2, 9, 8) },
        { direction: "in" as const, authorType: "contact" as const, authorName: "Priya (The Ivy House)", body: "Amazing. One change — could we push it to 5pm? We've got a lunch service running.", internal: false, createdAt: dayAt(1, 13, 20) },
        { direction: "out" as const, authorType: "user" as const, authorName: "James", authorUserId: "usr_james", body: "@nathan can the Bristol route take a 5pm slot for the Ivy House? Lunch clash their end.", internal: true, createdAt: dayAt(1, 13, 24) },
        { direction: "in" as const, authorType: "contact" as const, authorName: "James · Swiftee", body: "Yep, 5pm works — I'll re-slot the route now. 👍", internal: false, createdAt: mins(35) },
      ],
    },
    {
      contact: { id: "ct_north", displayName: "Northside Logistics", company: "Logistics · Leeds", avatarColor: "linear-gradient(135deg,#0EA5E9,#2563EB)", phone: "+44 113 555 0148", email: "accounts@northside.io", tags: ["Wholesale", "Net-30"] },
      conv: { id: "conv_north", inboxId: "inbox_wa", channel: "whatsapp" as const, subject: null as string | null, status: "open" as const, assigneeUserId: null, assignedTeamId: "team_support", priority: "normal" as const, unread: true, unreadCount: 3, slaDueAt: mins(40), preview: "Invoice #4471 — is this the right VAT rate?" },
      labels: ["lbl_billing"],
      messages: [
        { direction: "in" as const, authorType: "contact" as const, authorName: "Northside Logistics", body: "Hi team — is the VAT rate on invoice #4471 right? We're zero-rated on transport.", internal: false, createdAt: dayAt(1, 16, 12) },
        { direction: "in" as const, authorType: "contact" as const, authorName: "Northside Logistics", body: "No rush, just before month end 🙏", internal: false, createdAt: mins(180) },
      ],
    },
    {
      contact: { id: "ct_tide", displayName: "Tide & Co.", company: "Wholesale · Cardiff", avatarColor: "linear-gradient(135deg,#14B8A6,#0EA5E9)", phone: "+44 29 2055 0166", email: "team@tideandco.com", tags: ["Wholesale", "New lead"] },
      conv: { id: "conv_tide", inboxId: "inbox_support", channel: "email" as const, subject: "New supplier onboarding" as string | null, status: "open" as const, assigneeUserId: null, assignedTeamId: "team_support", priority: "normal" as const, unread: true, unreadCount: 1, slaDueAt: mins(165), preview: "New supplier onboarding — a few questions" },
      labels: ["lbl_onboarding"],
      messages: [
        { direction: "in" as const, authorType: "contact" as const, authorName: "Tide & Co.", body: "Hello! We're getting set up as a new supplier and had a few questions about delivery windows.", internal: false, createdAt: mins(92) },
      ],
    },
  ];

  for (const s of seedConversations) {
    await prisma.contact.upsert({
      where: { id: s.contact.id },
      update: { tags: s.contact.tags ?? [] },
      create: {
        id: s.contact.id,
        orgId: ORG,
        displayName: s.contact.displayName,
        company: s.contact.company,
        avatarColor: s.contact.avatarColor,
        tags: s.contact.tags ?? [],
        identities: {
          create: [
            { kind: "phone", value: s.contact.phone },
            { kind: "email", value: s.contact.email },
          ],
        },
      },
    });

    const newest = s.messages.reduce(
      (a, m) => (m.createdAt > a ? m.createdAt : a),
      s.messages[0].createdAt,
    );

    await prisma.conversation.upsert({
      where: { id: s.conv.id },
      // Refresh the shell on every deploy so the demo's dates and SLA stay
      // current instead of frozen at whenever the DB was first seeded.
      update: {
        status: s.conv.status,
        assigneeUserId: s.conv.assigneeUserId,
        assignedTeamId: s.conv.assignedTeamId,
        priority: s.conv.priority,
        unread: s.conv.unread,
        unreadCount: s.conv.unreadCount ?? 0,
        preview: s.conv.preview,
        slaDueAt: s.conv.slaDueAt,
        lastActivityAt: newest,
        seq: s.messages.length,
      },
      create: {
        id: s.conv.id,
        orgId: ORG,
        inboxId: s.conv.inboxId,
        contactId: s.contact.id,
        channel: s.conv.channel,
        subject: s.conv.subject,
        status: s.conv.status,
        assigneeUserId: s.conv.assigneeUserId,
        assignedTeamId: s.conv.assignedTeamId,
        priority: s.conv.priority,
        unread: s.conv.unread,
        unreadCount: s.conv.unreadCount ?? 0,
        preview: s.conv.preview,
        slaDueAt: s.conv.slaDueAt,
        lastActivityAt: newest,
        seq: s.messages.length,
        labels: { create: s.labels.map((labelId) => ({ labelId })) },
      },
    });

    // Rebuild the demo history each run so the seeded timestamps track real
    // "now" (2 days ago / yesterday / today) rather than the first-seed date.
    await prisma.message.deleteMany({ where: { conversationId: s.conv.id } });
    await prisma.message.createMany({
      data: s.messages.map((m, idx) => ({
        conversationId: s.conv.id,
        seq: idx + 1,
        direction: m.direction,
        authorType: m.authorType,
        authorName: m.authorName,
        authorUserId: "authorUserId" in m ? (m.authorUserId as string) : null,
        body: m.body,
        internal: m.internal,
        status: m.direction === "out" ? ("read" as const) : ("delivered" as const),
        createdAt: m.createdAt,
      })),
    });
  }

  console.log("✓ Seeded Swiftee org, users, teams, inboxes, and demo conversations.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
