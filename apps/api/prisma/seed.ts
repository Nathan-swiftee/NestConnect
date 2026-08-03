/**
 * Starter seed for the Postgres path. Idempotent (upserts by id), and aligned
 * with the in-memory fixtures so the DB-backed app looks identical to the
 * zero-infra demo. Run: `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG = "org_swiftee";

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
    await prisma.user.upsert({ where: { id: u.id }, update: {}, create: { orgId: ORG, ...u } });
  }

  const teams = [
    { id: "team_support", name: "Support team" },
    { id: "team_sales", name: "Sales team" },
  ];
  for (const t of teams) {
    await prisma.team.upsert({ where: { id: t.id }, update: {}, create: { orgId: ORG, ...t } });
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
    { id: "inbox_wa", type: "whatsapp" as const, name: "+44 20 7946", handle: "+44 20 7946 0100", teams: ["team_support"] },
    { id: "inbox_ivy", type: "whatsapp_group" as const, name: "The Ivy House", handle: "The Ivy House · group", teams: ["team_support"] },
    { id: "inbox_support", type: "email" as const, name: "support@swiftee.co.uk", handle: "support@swiftee.co.uk", teams: ["team_support"] },
    { id: "inbox_hello", type: "email" as const, name: "hello@swiftee.co.uk", handle: "hello@swiftee.co.uk", teams: ["team_sales"] },
  ];
  for (const i of inboxes) {
    await prisma.inbox.upsert({
      where: { id: i.id },
      update: {},
      create: { id: i.id, orgId: ORG, type: i.type, name: i.name, handle: i.handle },
    });
    for (const teamId of i.teams) {
      await prisma.inboxTeam.upsert({
        where: { inboxId_teamId: { inboxId: i.id, teamId } },
        update: {},
        create: { inboxId: i.id, teamId },
      });
    }
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
      contact: { id: "ct_ivy", displayName: "The Ivy House", company: "Venue · Bristol", avatarColor: "linear-gradient(135deg,#F97316,#DB2777)", phone: "+44 117 496 0122", email: "ops@theivyhouse.co.uk" },
      conv: { id: "conv_ivy", inboxId: "inbox_ivy", channel: "whatsapp_group" as const, status: "open" as const, assigneeUserId: "usr_nathan", assignedTeamId: "team_support", priority: "high" as const, unread: true, preview: "James · Swiftee: 5pm works — re-slotting now 👍" },
      labels: ["lbl_vip", "lbl_delivery"],
      messages: [
        { direction: "in" as const, authorType: "contact" as const, authorName: "Priya (The Ivy House)", body: "Amazing. Could we push the linen drop to 5pm? Lunch service running.", internal: false },
        { direction: "out" as const, authorType: "user" as const, authorName: "James", authorUserId: "usr_james", body: "@nathan can the Bristol route take a 5pm slot for the Ivy House?", internal: true },
        { direction: "in" as const, authorType: "contact" as const, authorName: "James · Swiftee", body: "Yep, 5pm works — I'll re-slot the route now. 👍", internal: false },
      ],
    },
    {
      contact: { id: "ct_north", displayName: "Northside Logistics", company: "Logistics · Leeds", avatarColor: "linear-gradient(135deg,#0EA5E9,#2563EB)", phone: "+44 113 555 0148", email: "accounts@northside.io" },
      conv: { id: "conv_north", inboxId: "inbox_wa", channel: "whatsapp" as const, status: "open" as const, assigneeUserId: null, assignedTeamId: "team_support", priority: "normal" as const, unread: true, preview: "Invoice #4471 — is this the right VAT rate?" },
      labels: ["lbl_billing"],
      messages: [
        { direction: "in" as const, authorType: "contact" as const, authorName: "Northside Logistics", body: "Hi team — is the VAT rate on invoice #4471 right? We're zero-rated on transport.", internal: false },
      ],
    },
    {
      contact: { id: "ct_tide", displayName: "Tide & Co.", company: "Wholesale · Cardiff", avatarColor: "linear-gradient(135deg,#14B8A6,#0EA5E9)", phone: "+44 29 2055 0166", email: "team@tideandco.com" },
      conv: { id: "conv_tide", inboxId: "inbox_support", channel: "email" as const, status: "open" as const, assigneeUserId: null, assignedTeamId: "team_support", priority: "normal" as const, unread: true, preview: "New supplier onboarding — a few questions" },
      labels: ["lbl_onboarding"],
      messages: [
        { direction: "in" as const, authorType: "contact" as const, authorName: "Tide & Co.", body: "Hello! We're getting set up as a new supplier and had a few questions about delivery windows.", internal: false },
      ],
    },
  ];

  for (const s of seedConversations) {
    await prisma.contact.upsert({
      where: { id: s.contact.id },
      update: {},
      create: {
        id: s.contact.id,
        orgId: ORG,
        displayName: s.contact.displayName,
        company: s.contact.company,
        avatarColor: s.contact.avatarColor,
        identities: {
          create: [
            { kind: "phone", value: s.contact.phone },
            { kind: "email", value: s.contact.email },
          ],
        },
      },
    });

    await prisma.conversation.upsert({
      where: { id: s.conv.id },
      update: {},
      create: {
        id: s.conv.id,
        orgId: ORG,
        inboxId: s.conv.inboxId,
        contactId: s.contact.id,
        channel: s.conv.channel,
        status: s.conv.status,
        assigneeUserId: s.conv.assigneeUserId,
        assignedTeamId: s.conv.assignedTeamId,
        priority: s.conv.priority,
        unread: s.conv.unread,
        preview: s.conv.preview,
        seq: s.messages.length,
        labels: { create: s.labels.map((labelId) => ({ labelId })) },
        messages: {
          create: s.messages.map((m, idx) => ({
            seq: idx + 1,
            direction: m.direction,
            authorType: m.authorType,
            authorName: m.authorName,
            authorUserId: "authorUserId" in m ? (m.authorUserId as string) : null,
            body: m.body,
            internal: m.internal,
            status: m.direction === "out" ? "read" : "delivered",
          })),
        },
      },
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
