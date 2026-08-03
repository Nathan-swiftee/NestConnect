import type {
  Conversation,
  Contact,
  Inbox,
  Message,
  Participant,
  Team,
  User,
} from "@ding/schemas";

/**
 * Demo seed data for Phase 0. The API serves this from an in-memory store so
 * the whole stack runs with zero infrastructure. The same shapes come out of
 * Postgres once the Prisma repository is wired in (see prisma/schema.prisma).
 */

export const ORG_ID = "org_swiftee";
export const DEMO_USER_ID = "usr_nathan";

/** A conversation plus its message history, as held in the store. */
export type ConversationRecord = Conversation & {
  messages: Message[];
  participants?: Participant[];
};

const now = new Date("2026-08-03T14:20:00.000Z");
const mins = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

const LABEL = {
  vip: { id: "lbl_vip", name: "VIP", color: "#0FA47A" },
  delivery: { id: "lbl_delivery", name: "Delivery", color: "#E68A00" },
  billing: { id: "lbl_billing", name: "Billing", color: "#5B8DEF" },
  order: { id: "lbl_order", name: "Order", color: "#0FA47A" },
  onboarding: { id: "lbl_onboarding", name: "Onboarding", color: "#A06CF2" },
  resolved: { id: "lbl_resolved", name: "Resolved", color: "#8A968F" },
};

export function makeSeed() {
  const users: User[] = [
    { id: DEMO_USER_ID, orgId: ORG_ID, name: "Nathan A", email: "nathan@swiftee.co.uk", role: "admin", avatarColor: "linear-gradient(135deg,#3B82F6,#8B5CF6)", online: true },
    { id: "usr_james", orgId: ORG_ID, name: "James", email: "james@swiftee.co.uk", role: "agent", avatarColor: "linear-gradient(135deg,#0EA5E9,#22D3EE)", online: true },
    { id: "usr_amara", orgId: ORG_ID, name: "Amara", email: "amara@swiftee.co.uk", role: "agent", avatarColor: "linear-gradient(135deg,#F43F5E,#F59E0B)", online: false },
  ];

  const teams: Team[] = [
    { id: "team_support", orgId: ORG_ID, name: "Support team" },
    { id: "team_sales", orgId: ORG_ID, name: "Sales team" },
  ];

  // Demo "me" (Nathan) belongs to both teams.
  const membership: Record<string, string[]> = {
    [DEMO_USER_ID]: ["team_support", "team_sales"],
    usr_james: ["team_support"],
    usr_amara: ["team_sales"],
  };

  const inboxes: Inbox[] = [
    { id: "inbox_wa", orgId: ORG_ID, type: "whatsapp", name: "+44 20 7946", handle: "+44 20 7946 0100", teamIds: ["team_support"], routingStrategy: "manual", unread: 2 },
    { id: "inbox_ivy", orgId: ORG_ID, type: "whatsapp_group", name: "The Ivy House", handle: "The Ivy House · group", teamIds: ["team_support"], routingStrategy: "manual", unread: 1 },
    { id: "inbox_support", orgId: ORG_ID, type: "email", name: "support@swiftee.co.uk", handle: "support@swiftee.co.uk", teamIds: ["team_support"], routingStrategy: "round_robin", unread: 1 },
    { id: "inbox_hello", orgId: ORG_ID, type: "email", name: "hello@swiftee.co.uk", handle: "hello@swiftee.co.uk", teamIds: ["team_sales"], routingStrategy: "round_robin", unread: 0 },
  ];

  const c = (contact: Contact) => contact;
  const contacts = {
    ivy: c({ id: "ct_ivy", orgId: ORG_ID, displayName: "The Ivy House", company: "Venue · Bristol", phone: "+44 117 496 0122", email: "ops@theivyhouse.co.uk", avatarColor: "linear-gradient(135deg,#F97316,#DB2777)" }),
    north: c({ id: "ct_north", orgId: ORG_ID, displayName: "Northside Logistics", company: "Logistics · Leeds", phone: "+44 113 555 0148", email: "accounts@northside.io", avatarColor: "linear-gradient(135deg,#0EA5E9,#2563EB)" }),
    bloom: c({ id: "ct_bloom", orgId: ORG_ID, displayName: "Bloom Florists", company: "Retail · Manchester", phone: "+44 161 555 0193", email: "hello@bloomflorists.co.uk", avatarColor: "linear-gradient(135deg,#10B981,#059669)" }),
    harbour: c({ id: "ct_harbour", orgId: ORG_ID, displayName: "Harbour Hotel", company: "Hospitality · Bristol", phone: "+44 117 555 0176", email: "front@harbourhotel.co.uk", avatarColor: "linear-gradient(135deg,#6366F1,#A855F7)" }),
    acme: c({ id: "ct_acme", orgId: ORG_ID, displayName: "Acme Café", company: "Café · Bath", phone: "+44 1225 555 0110", email: "ana@acmecafe.co.uk", avatarColor: "linear-gradient(135deg,#F59E0B,#EF4444)" }),
    tide: c({ id: "ct_tide", orgId: ORG_ID, displayName: "Tide & Co.", company: "Wholesale · Cardiff", phone: "+44 29 2055 0166", email: "team@tideandco.com", avatarColor: "linear-gradient(135deg,#14B8A6,#0EA5E9)" }),
  };

  // Members of the demo WhatsApp group "The Ivy House" (client people + a Swiftee rep).
  const ivyMembers: Contact[] = [
    { id: "ct_priya", orgId: ORG_ID, displayName: "Priya · Ivy House", phone: "+44 117 496 0122", avatarColor: "linear-gradient(135deg,#F97316,#DB2777)" },
    { id: "ct_marco", orgId: ORG_ID, displayName: "Marco · Ivy House", phone: "+44 117 496 0140", avatarColor: "linear-gradient(135deg,#8B5CF6,#6366F1)" },
    { id: "ct_jamesg", orgId: ORG_ID, displayName: "James · Swiftee", phone: "+44 20 7946 0100", avatarColor: "linear-gradient(135deg,#0EA5E9,#22D3EE)" },
  ];

  let mid = 0;
  const msg = (
    conversationId: string,
    seq: number,
    direction: "in" | "out",
    authorType: "contact" | "user" | "system",
    authorName: string,
    body: string,
    minsAgo: number,
    opts: { internal?: boolean; status?: Message["status"] } = {},
  ): Message => ({
    id: `msg_${++mid}`,
    conversationId,
    seq,
    direction,
    authorType,
    authorName,
    body,
    status: opts.status ?? (direction === "out" ? "read" : "delivered"),
    internal: opts.internal ?? false,
    createdAt: mins(minsAgo),
  });

  const conversations: ConversationRecord[] = [
    {
      id: "conv_ivy", orgId: ORG_ID, inboxId: "inbox_ivy", channel: "whatsapp_group",
      channelRef: "group_ivy_demo", inviteLink: "https://chat.whatsapp.com/DINGivyhouse01",
      contact: contacts.ivy, subject: "The Ivy House", status: "open", assigneeUserId: DEMO_USER_ID, assignedTeamId: "team_support",
      priority: "high", labels: [LABEL.vip, LABEL.delivery], unread: true,
      participants: ivyMembers.map((m, i) => ({ id: `part_ivy_${i + 1}`, conversationId: "conv_ivy", contact: m, role: (i === 2 ? "admin" : "member") as "admin" | "member", joinedAt: mins(600) })),
      slaDueAt: mins(-72), lastActivityAt: mins(1), seq: 5, preview: "Priya: Can we push the delivery to 5pm?",
      messages: [
        msg("conv_ivy", 1, "in", "contact", "Priya (The Ivy House)", "Morning! Are we still on for the linen drop today?", 320),
        msg("conv_ivy", 2, "out", "user", "Nathan A", "Morning Priya 👋 Yes — the van's loaded, ETA around 2pm.", 318),
        msg("conv_ivy", 3, "in", "contact", "Priya (The Ivy House)", "Amazing. One change — could we push it to 5pm? We've got a lunch service running.", 60),
        msg("conv_ivy", 4, "out", "user", "James", "@nathan can the Bristol route take a 5pm slot for the Ivy House? Lunch clash their end.", 58, { internal: true }),
        msg("conv_ivy", 5, "in", "contact", "James · Swiftee", "Yep, 5pm works — I'll re-slot the route now. 👍", 1),
      ],
    },
    {
      id: "conv_north", orgId: ORG_ID, inboxId: "inbox_wa", channel: "whatsapp",
      contact: contacts.north, status: "open", assigneeUserId: null, assignedTeamId: "team_support",
      priority: "normal", labels: [LABEL.billing], unread: true,
      slaDueAt: mins(-220), lastActivityAt: mins(3), seq: 2, preview: "Invoice #4471 — is this the right VAT rate?",
      messages: [
        msg("conv_north", 1, "in", "contact", "Northside Logistics", "Hi team — quick one on invoice #4471, is the VAT rate right? Looks like 20% but we're zero-rated on transport.", 4),
        msg("conv_north", 2, "in", "contact", "Northside Logistics", "No rush, just before month end 🙏", 3),
      ],
    },
    {
      id: "conv_bloom", orgId: ORG_ID, inboxId: "inbox_support", channel: "email",
      contact: contacts.bloom, subject: "Weekly stem order", status: "open", assigneeUserId: DEMO_USER_ID, assignedTeamId: "team_support",
      priority: "normal", labels: [LABEL.order], unread: false,
      slaDueAt: null, lastActivityAt: mins(18), seq: 2, preview: "Re: Weekly stem order — confirmed for Thursday AM",
      messages: [
        msg("conv_bloom", 1, "in", "contact", "Bloom Florists", "Hi — attaching this week's PO for the stem order. Same delivery window as usual please.", 40),
        msg("conv_bloom", 2, "out", "user", "Nathan A", "Got it, thank you! Confirmed for Thursday AM. I'll send tracking once it's out.", 18),
      ],
    },
    {
      id: "conv_harbour", orgId: ORG_ID, inboxId: "inbox_wa", channel: "whatsapp",
      contact: contacts.harbour, status: "pending", assigneeUserId: null, assignedTeamId: "team_support",
      priority: "low", labels: [LABEL.resolved], unread: false,
      slaDueAt: null, lastActivityAt: mins(41), seq: 1, preview: "Reception: thanks, all sorted 👍",
      messages: [
        msg("conv_harbour", 1, "in", "contact", "Harbour Hotel", "Thanks, all sorted 👍", 41),
      ],
    },
    {
      id: "conv_acme", orgId: ORG_ID, inboxId: "inbox_wa", channel: "whatsapp",
      contact: contacts.acme, status: "open", assigneeUserId: DEMO_USER_ID, assignedTeamId: "team_support",
      priority: "normal", labels: [], unread: false,
      slaDueAt: null, lastActivityAt: mins(70), seq: 1, preview: "You: no problem, see you then!",
      messages: [
        msg("conv_acme", 1, "out", "user", "Nathan A", "No problem, see you then!", 70),
      ],
    },
    {
      id: "conv_tide", orgId: ORG_ID, inboxId: "inbox_support", channel: "email",
      contact: contacts.tide, subject: "New supplier onboarding", status: "open", assigneeUserId: null, assignedTeamId: "team_support",
      priority: "normal", labels: [LABEL.onboarding], unread: true,
      slaDueAt: mins(-300), lastActivityAt: mins(92), seq: 1, preview: "New supplier onboarding — a few questions",
      messages: [
        msg("conv_tide", 1, "in", "contact", "Tide & Co.", "Hello! We're getting set up as a new supplier and had a few questions about delivery windows and cut-off times.", 92),
      ],
    },
  ];

  return { users, teams, membership, inboxes, conversations };
}
