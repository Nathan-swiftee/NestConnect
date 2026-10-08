/**
 * The app-store reviewer's demo workspace.
 *
 * Google Play (and Apple) review an app by signing in to it. NestConnect is a
 * team inbox for businesses; there is nothing to see without a workspace, and
 * the real one holds real customers' conversations. So reviewers get their own:
 * a separate workspace (a tenant like any other — they cannot see or reach any
 * other workspace's data), flagged as a sandbox, holding invented data only.
 *
 * What "sandbox" means is in apps/api/src/tenancy/sandbox.ts. In short: replies
 * are simulated and never reach a provider; channels can't be connected; no
 * email, customer push or AI leaves it; the shared login can't be changed from
 * inside; and mandatory two-factor enrolment is waived for it, because a
 * reviewer can be given a password but not a phone.
 *
 * Every phone number is in Ofcom's range reserved for drama (07700 900xxx) and
 * every address is on a domain reserved for examples (RFC 2606), so nothing in
 * it is anybody's.
 *
 * Run it with reviewer-setup.ts (see docs/play-reviewer-access.md):
 *
 *   DATABASE_URL=… pnpm --filter @ding/api reviewer:setup --email <login> --generate-to <file>
 *   DATABASE_URL=… pnpm --filter @ding/api reviewer:setup --email <login> --password-stdin
 *   DATABASE_URL=… pnpm --filter @ding/api reviewer:setup --email <login> --keep-password
 *
 * The password is never printed. `--generate-to` writes a new random one to a
 * file only you can read (refusing to overwrite, and refusing a path inside the
 * repository); `--password-stdin` reads one you chose, from a hidden prompt or a
 * pipe; `--keep-password` refreshes the sample data and leaves the login alone.
 * Re-run before each review: it resets the sample data and its timestamps.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export const REVIEW_ORG_ID = "org_play_review";
export const REVIEW_USER_ID = "rv_user_reviewer";

export interface ProvisionResult {
  orgId: string;
  userId: string;
  email: string;
  conversations: number;
  contacts: number;
  passwordChanged: boolean;
}

/** Create or refresh the reviewer workspace. Pass `passwordHash` to set (or
 *  rotate) the login's password; omit it to keep the existing one. */
export async function provisionReviewerWorkspace(
  prisma: PrismaClient,
  opts: { email: string; passwordHash?: string; now?: Date },
): Promise<ProvisionResult> {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email must be an email address");
  const now = opts.now ?? new Date();
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  // Never adopt a real workspace, and never take a real person's login.
  const org = await prisma.organization.findUnique({ where: { id: REVIEW_ORG_ID } });
  if (org && !org.sandbox) {
    throw new Error(`${REVIEW_ORG_ID} exists and is not a sandbox — refusing to touch it`);
  }
  const clash = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, NOT: { orgId: REVIEW_ORG_ID } },
    select: { id: true },
  });
  if (clash) throw new Error("That email address is already an account in another workspace");
  const existingUser = await prisma.user.findUnique({ where: { id: REVIEW_USER_ID } });
  if (!existingUser && !opts.passwordHash) {
    throw new Error("A new reviewer account needs a password (--generate-to or --password-stdin)");
  }

  await prisma.organization.upsert({
    where: { id: REVIEW_ORG_ID },
    create: { id: REVIEW_ORG_ID, name: "Harbour & Oak (demo)", sandbox: true },
    update: { name: "Harbour & Oak (demo)", sandbox: true },
  });

  await wipeSampleData(prisma);

  const team = await prisma.team.create({
    data: { id: "rv_team_foh", orgId: REVIEW_ORG_ID, name: "Front of house", icon: "headset", slaMinutes: 60 },
  });

  // The login. An agent, not an admin: it can work the inbox but not invite
  // people, connect channels or change settings. Two-factor is cleared — the
  // sandbox waives enrolment, and a reviewer must never meet a challenge.
  const userData = {
    orgId: REVIEW_ORG_ID,
    name: "Play Reviewer",
    email,
    role: "agent" as const,
    avatarColor: "linear-gradient(135deg,#0EA5E9,#2563EB)",
    inviteTokenHash: null,
    inviteExpiresAt: null,
    twoFactorEnabled: false,
    twoFactorMethod: null,
    totpSecret: null,
    twoFactorEmailCodeHash: null,
    twoFactorEmailCodeExpires: null,
    ...(opts.passwordHash ? { passwordHash: opts.passwordHash } : {}),
  };
  await prisma.user.upsert({
    where: { id: REVIEW_USER_ID },
    create: { id: REVIEW_USER_ID, ...userData },
    update: userData,
  });
  await prisma.teamMember.create({ data: { userId: REVIEW_USER_ID, teamId: team.id } });
  // A new password signs every earlier session out; a refresh keeps them.
  if (opts.passwordHash) {
    await prisma.device.deleteMany({ where: { userId: REVIEW_USER_ID } });
    await prisma.session.deleteMany({ where: { userId: REVIEW_USER_ID } });
  }

  // The business's channels. Not connected to anything real: no credentials,
  // and the sandbox simulates every send from them.
  const inboxes = {
    wa: await prisma.inbox.create({
      data: {
        id: "rv_inbox_wa", orgId: REVIEW_ORG_ID, type: "whatsapp", name: "WhatsApp · +44 7700 900000",
        handle: "+44 7700 900000", routingStrategy: "manual", order: 0,
        teams: { create: [{ teamId: team.id }] },
      },
    }),
    email: await prisma.inbox.create({
      data: {
        id: "rv_inbox_email", orgId: REVIEW_ORG_ID, type: "email", name: "hello@harbour-oak.example.com",
        handle: "hello@harbour-oak.example.com", routingStrategy: "manual", order: 1,
        teams: { create: [{ teamId: team.id }] },
      },
    }),
    chat: await prisma.inbox.create({
      data: {
        id: "rv_inbox_chat", orgId: REVIEW_ORG_ID, type: "nestchat", name: "Website chat",
        handle: "harbour-oak.example.com", routingStrategy: "manual", order: 2,
        channelConfig: { widgetKey: `nc_demo_${randomBytes(12).toString("hex")}` },
        teams: { create: [{ teamId: team.id }] },
      },
    }),
  };

  const labels = {
    booking: await prisma.label.create({ data: { id: "rv_lbl_booking", orgId: REVIEW_ORG_ID, name: "Booking", color: "#0FA47A" } }),
    order: await prisma.label.create({ data: { id: "rv_lbl_order", orgId: REVIEW_ORG_ID, name: "Order", color: "#E68A00" } }),
    feedback: await prisma.label.create({ data: { id: "rv_lbl_feedback", orgId: REVIEW_ORG_ID, name: "Feedback", color: "#5B8DEF" } }),
  };

  await prisma.template.createMany({
    data: [
      { id: "rv_tpl_booking", orgId: REVIEW_ORG_ID, name: "booking_confirmed", category: "utility", language: "en", approvalStatus: "approved",
        body: "Hi {{1}}, your table for {{2}} on {{3}} is confirmed. Reply here if anything changes!", variableDefaults: ["{{contact.first_name}}"] },
      { id: "rv_tpl_order", orgId: REVIEW_ORG_ID, name: "order_ready", category: "utility", language: "en", approvalStatus: "approved",
        body: "Hi {{1}}, your order {{2}} is ready to collect.", variableDefaults: ["{{contact.first_name}}"] },
    ],
  });

  // The customers — invented, on reserved numbers and example domains.
  const people = [
    { id: "rv_ct_alex", name: "Alex Morgan", phone: "+447700900101", email: "alex.morgan@example.com", color: "#F97316" },
    { id: "rv_ct_priya", name: "Priya Shah", phone: "+447700900102", email: "priya.shah@example.org", color: "#10B981" },
    { id: "rv_ct_jordan", name: "Jordan Blake", phone: "+447700900103", email: "jordan.blake@example.net", color: "#6366F1" },
    { id: "rv_ct_sam", name: "Sam Taylor", phone: "+447700900104", email: "sam.taylor@example.com", color: "#F59E0B" },
    { id: "rv_ct_visitor", name: "Website visitor", phone: null, email: null, color: "#14B8A6" },
  ];
  for (const p of people) {
    await prisma.contact.create({
      data: {
        id: p.id, orgId: REVIEW_ORG_ID, displayName: p.name, avatarColor: p.color,
        identities: {
          create: [
            ...(p.phone ? [{ orgId: REVIEW_ORG_ID, kind: "phone", value: p.phone, normalizedValue: p.phone }] : []),
            ...(p.email ? [{ orgId: REVIEW_ORG_ID, kind: "email", value: p.email, normalizedValue: p.email }] : []),
            ...(p.phone || p.email ? [] : [{ orgId: REVIEW_ORG_ID, kind: "nestchat", value: `demo-visitor-${p.id}` }]),
          ],
        },
      },
    });
  }

  type Msg = { dir: "in" | "out"; by: string; body: string; at: number; internal?: boolean };
  const threads: {
    id: string; inboxId: string; contactId: string; channel: "whatsapp" | "email" | "nestchat";
    subject?: string; status?: "open" | "pending"; assigned?: boolean; unread?: number; label?: string; messages: Msg[];
  }[] = [
    {
      id: "rv_conv_alex", inboxId: inboxes.wa.id, contactId: "rv_ct_alex", channel: "whatsapp", assigned: true, unread: 1, label: labels.booking.id,
      messages: [
        { dir: "in", by: "Alex Morgan", body: "Hi! Could I book a table for 4 this Saturday at 7pm?", at: 95 },
        { dir: "out", by: "Play Reviewer", body: "Hi Alex 👋 We have 7:15 free on Saturday — would that work?", at: 90 },
        { dir: "in", by: "Alex Morgan", body: "7:15 is perfect, thank you! One of us is vegetarian.", at: 12 },
      ],
    },
    {
      id: "rv_conv_priya", inboxId: inboxes.wa.id, contactId: "rv_ct_priya", channel: "whatsapp", unread: 2, label: labels.order.id,
      messages: [
        { dir: "in", by: "Priya Shah", body: "Hello, is the lemon drizzle cake available to order for Friday?", at: 40 },
        { dir: "in", by: "Priya Shah", body: "It's for 12 people 🎂", at: 38 },
      ],
    },
    {
      id: "rv_conv_jordan", inboxId: inboxes.email.id, contactId: "rv_ct_jordan", channel: "email", subject: "Private hire enquiry", unread: 1,
      messages: [
        { dir: "in", by: "Jordan Blake", body: "Hello, we're looking to hire the back room for a 30-person event in June. Could you share availability and pricing?", at: 180 },
      ],
    },
    {
      id: "rv_conv_sam", inboxId: inboxes.wa.id, contactId: "rv_ct_sam", channel: "whatsapp", status: "pending", label: labels.feedback.id,
      messages: [
        { dir: "in", by: "Sam Taylor", body: "Just wanted to say the brunch yesterday was lovely!", at: 300 },
        { dir: "out", by: "Play Reviewer", body: "Thank you Sam, that's so kind — we'll pass it on to the kitchen 😊", at: 290 },
        { dir: "out", by: "Play Reviewer", body: "Sam left lovely feedback — sharing with the team.", at: 289, internal: true },
      ],
    },
    {
      id: "rv_conv_visitor", inboxId: inboxes.chat.id, contactId: "rv_ct_visitor", channel: "nestchat", unread: 1,
      messages: [
        { dir: "in", by: "Website visitor", body: "Do you have gluten-free options on the lunch menu?", at: 6 },
      ],
    },
  ];
  for (const t of threads) {
    const newest = Math.min(...t.messages.map((m) => m.at));
    const lastIn = t.messages.filter((m) => m.dir === "in").map((m) => m.at);
    const last = t.messages[t.messages.length - 1]!;
    await prisma.conversation.create({
      data: {
        id: t.id, orgId: REVIEW_ORG_ID, inboxId: t.inboxId, contactId: t.contactId, channel: t.channel,
        subject: t.subject ?? null, status: t.status ?? "open",
        assigneeUserId: t.assigned ? REVIEW_USER_ID : null, assignedTeamId: team.id,
        unread: (t.unread ?? 0) > 0, unreadCount: t.unread ?? 0,
        lastActivityAt: ago(newest), lastInboundAt: lastIn.length ? ago(Math.min(...lastIn)) : null,
        seq: t.messages.length, preview: last.body.slice(0, 140),
        ...(t.label ? { labels: { create: [{ labelId: t.label }] } } : {}),
      },
    });
    await prisma.message.createMany({
      data: t.messages.map((m, i) => ({
        conversationId: t.id, seq: i + 1, direction: m.dir,
        authorType: m.dir === "in" ? "contact" : "user",
        authorUserId: m.dir === "out" ? REVIEW_USER_ID : null,
        authorName: m.by, body: m.body, internal: m.internal ?? false,
        channel: t.channel,
        status: m.dir === "out" ? (m.internal ? "sent" : "read") : "delivered",
        createdAt: ago(m.at),
      })),
    });
  }

  return {
    orgId: REVIEW_ORG_ID,
    userId: REVIEW_USER_ID,
    email,
    conversations: threads.length,
    contacts: people.length,
    passwordChanged: Boolean(opts.passwordHash),
  };
}

/** Remove the sample data (everything in the workspace except the login). */
async function wipeSampleData(prisma: PrismaClient): Promise<void> {
  const org = REVIEW_ORG_ID;
  const convIds = (await prisma.conversation.findMany({ where: { orgId: org }, select: { id: true } })).map((c) => c.id);
  const msgIds = (await prisma.message.findMany({ where: { conversationId: { in: convIds } }, select: { id: true } })).map((m) => m.id);
  await prisma.attachment.deleteMany({ where: { OR: [{ orgId: org }, { messageId: { in: msgIds } }] } });
  await prisma.emailRecipient.deleteMany({ where: { messageId: { in: msgIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversationLabel.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.participant.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.note.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.assignmentEvent.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.customFieldValue.deleteMany({ where: { orgId: org } });
  await prisma.conversation.deleteMany({ where: { orgId: org } });
  await prisma.customerDevice.deleteMany({ where: { orgId: org } });
  await prisma.contactIdentity.deleteMany({ where: { contact: { orgId: org } } });
  await prisma.contact.deleteMany({ where: { orgId: org } });
  await prisma.inboxTeam.deleteMany({ where: { inbox: { orgId: org } } });
  await prisma.inbox.deleteMany({ where: { orgId: org } });
  await prisma.label.deleteMany({ where: { orgId: org } });
  await prisma.template.deleteMany({ where: { orgId: org } });
  await prisma.customField.deleteMany({ where: { orgId: org } });
  await prisma.appSetting.deleteMany({ where: { orgId: org } });
  await prisma.notification.deleteMany({ where: { user: { orgId: org } } });
  await prisma.recoveryCode.deleteMany({ where: { user: { orgId: org } } });
  await prisma.teamMember.deleteMany({ where: { team: { orgId: org } } });
  await prisma.team.deleteMany({ where: { orgId: org } });
  // Any account other than the reviewer login that somehow got here goes too.
  const strays = await prisma.user.findMany({ where: { orgId: org, NOT: { id: REVIEW_USER_ID } }, select: { id: true } });
  for (const s of strays) {
    await prisma.device.deleteMany({ where: { userId: s.id } });
    await prisma.session.deleteMany({ where: { userId: s.id } });
    await prisma.user.delete({ where: { id: s.id } });
  }
}
