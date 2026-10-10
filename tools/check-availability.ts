/**
 * Who is here: availability, working hours, and what follows from them.
 *
 *   1. Working hours are read in the person's own time zone, including a
 *      shift that runs past midnight; a zone the runtime doesn't know is read
 *      as UTC rather than making somebody permanently away.
 *   2. Round-robin hands nothing to somebody switched off or outside their
 *      hours — including a customer's own person, whose chat goes to the team.
 *   3. The website chat is "online" only while somebody who answers *that*
 *      channel is available. It used to be "anybody in the workspace has the
 *      app open", which said Online while every one of them was away.
 *   4. A visitor who left still hears back: a reply unseen for five minutes is
 *      emailed to the address they gave — once, not if they read it or
 *      answered, not without an address, not when the channel turned it off,
 *      never from a demo workspace, and again on the next pass if the email
 *      failed.
 *
 *     pnpm check:availability
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID, DEMO_USER_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorEmailService, UNSEEN_REPLY_EMAIL_AFTER_MS } from "../apps/api/src/channels/nestchat/visitor-email.service";
import type { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import type { Mailer, MailInput } from "../apps/api/src/mail/mailer.service";
import type { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import {
  DEFAULT_AVAILABILITY_SCHEDULE,
  LEGACY_AWAY_MESSAGE,
  availableNow,
  withinSchedule,
  type AvailabilitySchedule,
} from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const hours = (patch: Partial<AvailabilitySchedule> = {}): AvailabilitySchedule => ({
  ...DEFAULT_AVAILABILITY_SCHEDULE,
  enabled: true,
  ...patch,
});
const allOff = hours({
  days: Object.fromEntries(
    (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => [d, { on: false, start: "09:00", end: "17:00" }]),
  ) as AvailabilitySchedule["days"],
});
const allDay = hours({
  days: Object.fromEntries(
    (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => [d, { on: true, start: "00:00", end: "00:00" }]),
  ) as AvailabilitySchedule["days"],
});

async function main(): Promise<void> {
  console.log("\nWorking hours\n");
  // Thursday 8 October 2026.
  const thuLondon = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00+01:00`); // BST
  const weekday = hours({ timezone: "Europe/London" });
  ok("inside Mon–Fri 9–17:30 on a Thursday", withinSchedule(weekday, thuLondon("10:00")));
  ok("not before nine", !withinSchedule(weekday, thuLondon("08:59")));
  ok("not at half five", !withinSchedule(weekday, thuLondon("17:30")));
  ok("not on a Saturday", !withinSchedule(weekday, new Date("2026-10-10T11:00:00+01:00")));
  ok("read in their own zone", withinSchedule(hours({ timezone: "America/New_York" }), new Date("2026-10-08T15:00:00+01:00")) &&
    !withinSchedule(hours({ timezone: "America/New_York" }), new Date("2026-10-08T12:00:00+01:00")));
  const nights = hours({ timezone: "Europe/London", days: { ...allOff.days, thu: { on: true, start: "22:00", end: "06:00" } } });
  ok("a night shift starts on its day", withinSchedule(nights, thuLondon("23:00")));
  ok("and runs past midnight into the next", withinSchedule(nights, new Date("2026-10-09T03:00:00+01:00")));
  ok("and ends when it says", !withinSchedule(nights, new Date("2026-10-09T06:30:00+01:00")));
  ok("hours switched off don't decide", withinSchedule({ ...weekday, enabled: false }, thuLondon("03:00")));
  ok("an unknown zone is read as UTC, not as never", withinSchedule(hours({ timezone: "Mars/Olympus" }), new Date("2026-10-08T10:00:00Z")));
  ok("switched off is unavailable whatever the hours", !availableNow({ available: false, schedule: allDay }));
  ok("switched on outside hours is unavailable", !availableNow({ available: true, schedule: allOff }));
  ok("switched on with no hours is available", availableNow({ available: true, schedule: null }));

  const store = new MemoryStore();
  const nathan = DEMO_USER_ID;
  const james = "usr_james";

  console.log("\nRound-robin\n");
  const routing = new RoutingService(store);
  const support = (await store.getInbox("inbox_support"))!; // round_robin, team_support: nathan + james
  const contact = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "email", value: "rr@example.com", displayName: "RR" });
  await store.updateMyPreferences(james, { schedule: allOff });
  const picks = new Set<string | null>();
  for (let i = 0; i < 6; i++) picks.add((await routing.route(support, contact)).assigneeUserId);
  ok("nobody outside their hours is handed a chat", !picks.has(james) && picks.has(nathan), [...picks].join(","));
  await store.updateMyPreferences(nathan, { available: false });
  const none = await routing.route(support, contact);
  ok("nobody available: it waits in the team's queue", none.assigneeUserId === null && none.assignedTeamId === "team_support");
  await store.updateMyPreferences(nathan, { available: true });
  await store.updateMyPreferences(james, { schedule: allDay });
  const both = new Set<string | null>();
  for (let i = 0; i < 6; i++) both.add((await routing.route(support, contact)).assigneeUserId);
  ok("inside their hours they're back in the rotation", both.has(james) && both.has(nathan));

  const owned = { ...contact, ownerUserId: james, ownerTeamId: "team_support" };
  ok("a customer's own person gets them when available", (await routing.route(support, owned)).assigneeUserId === james);
  await store.updateMyPreferences(james, { schedule: allOff });
  const away = await routing.route(support, owned);
  ok("and the team does when they're away", away.assigneeUserId === nathan && away.assignedTeamId === "team_support",
    String(away.assigneeUserId));

  console.log("\nThe website chat's online status\n");
  const nestchat = new NestChatService(store, {} as VisitorBus);
  const chat = await store.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Website chat", handle: "shop.example.com", teamIds: ["team_support"],
    routingStrategy: "manual",
  });
  await store.updateMyPreferences(nathan, { available: false });
  await store.updateMyPreferences(james, { available: true, schedule: allOff });
  ok("everybody who answers it unavailable: offline", !(await nestchat.channelOnline(chat)));
  await store.updateMyPreferences("usr_amara", { available: true, schedule: null }); // sales, not this channel
  ok("somebody on another team being here doesn't count", !(await nestchat.channelOnline(chat)));
  await store.updateMyPreferences(james, { schedule: allDay });
  ok("one of them inside their hours: online", await nestchat.channelOnline(chat));
  const appearance = await nestchat.appearanceFor(chat.id);
  ok("the default away message is the new one",
    appearance.awayMessage === "We're currently offline. We'll get back to you as soon as possible.");
  await store.updateInbox(chat.id, { channelConfig: { appearance: JSON.stringify({ awayMessage: LEGACY_AWAY_MESSAGE }) } });
  ok("a channel still on the old default moves to it",
    (await nestchat.appearanceFor(chat.id)).awayMessage !== LEGACY_AWAY_MESSAGE);
  await store.updateInbox(chat.id, { channelConfig: { appearance: JSON.stringify({ awayMessage: "Back at 9!" }) } });
  ok("one somebody wrote is kept", (await nestchat.appearanceFor(chat.id)).awayMessage === "Back at 9!");
  await store.updateInbox(chat.id, { channelConfig: { appearance: JSON.stringify({}) } });

  console.log("\nA visitor who left hears back\n");
  const sent: MailInput[] = [];
  let mailWorks = true;
  const mailer = {
    sendMail: async (m: MailInput) => {
      if (!mailWorks) return { sent: false, error: "down" };
      sent.push(m);
      return { sent: true, via: "resend" };
    },
  } as unknown as Mailer;
  let demo = false;
  const sandbox = { current: async () => demo, isSandbox: async () => demo } as unknown as SandboxPolicy;
  const emailer = new VisitorEmailService(store, mailer, nestchat, sandbox);
  await store.setPlatformSetting("nestchat_visitor_email_since", new Date(Date.now() - 3600_000).toISOString());
  const agent = (await store.getUser(nathan))!;

  const visit = async (tag: string, email?: string) => {
    const who = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: `v_${tag}`, displayName: `Visitor ${tag}` });
    if (email) await store.updateContact(who.id, { email } as never);
    const { conversation } = await store.findOrCreateOpenConversation({
      orgId: ORG_ID, inboxId: chat.id, contact: (await store.getContact(who.id))!, channel: "nestchat",
    });
    await store.appendInboundMessage(conversation.id, { authorName: "Visitor", body: `Hello from ${tag}`, channel: "nestchat" });
    return conversation.id;
  };
  const reply = async (convId: string, body: string, status: "delivered" | "read" = "delivered") => {
    const m = (await store.addMessage(convId, { body, internal: false }, agent))!;
    await store.markOutboundStatusUpTo(convId, m.id, status);
    return m;
  };
  const later = (ms: number) => new Date(Date.now() + ms);
  const due = later(UNSEEN_REPLY_EMAIL_AFTER_MS + 30_000);

  const a = await visit("a", "visitor.a@example.com");
  await reply(a, "Your order shipped this morning.");
  ok("not before five minutes", (await emailer.sweep(later(60_000))).length === 0);
  ok("after five, the unseen reply is emailed", (await emailer.sweep(due)).includes(a) && sent.length === 1);
  const mail = sent[0]!;
  ok("to the address they gave", mail.to === "visitor.a@example.com");
  ok("in the business's name", /from Swiftee/.test(mail.subject), mail.subject);
  ok("with the reply in it", mail.text.includes("Your order shipped this morning.") && mail.html.includes("Your order shipped"));
  ok("and a way back to the site", mail.text.includes("https://shop.example.com"));
  ok("once", (await emailer.sweep(due)).length === 0 && sent.length === 1);
  await reply(a, "Tracking: DG-1");
  await emailer.sweep(later(2 * UNSEEN_REPLY_EMAIL_AFTER_MS));
  ok("a later reply is its own email, without the first again",
    sent.length === 2 && sent[1]!.text.includes("DG-1") && !sent[1]!.text.includes("shipped this morning"));

  const b = await visit("b", "visitor.b@example.com");
  await reply(b, "Read on screen", "read");
  const c = await visit("c");
  await reply(c, "Nobody to send this to");
  const d = await visit("d", "visitor.d@example.com");
  await reply(d, "Answered already");
  await store.appendInboundMessage(d, { authorName: "Visitor", body: "Thanks!", channel: "nestchat" });
  const before = sent.length;
  const swept = await emailer.sweep(due);
  ok("not when they read it", !swept.includes(b));
  ok("not without an email address", !swept.includes(c));
  ok("not when they've answered since", !swept.includes(d));
  ok("nothing sent for any of them", sent.length === before);

  await store.updateInbox(chat.id, { channelConfig: { appearance: JSON.stringify({ emailReplies: false }) } });
  const e = await visit("e", "visitor.e@example.com");
  await reply(e, "Channel says no");
  ok("not when the channel has it turned off", !(await emailer.sweep(due)).includes(e));
  await store.updateInbox(chat.id, { channelConfig: { appearance: JSON.stringify({}) } });

  demo = true;
  const f = await visit("f", "visitor.f@example.com");
  await reply(f, "From the demo");
  ok("never from a demo workspace", !(await emailer.sweep(due)).includes(f));
  demo = false;

  mailWorks = false;
  const g = await visit("g", "visitor.g@example.com");
  await reply(g, "Try again later");
  ok("a failed email isn't counted as sent", !(await emailer.sweep(due)).includes(g));
  mailWorks = true;
  ok("and goes on the next pass", (await emailer.sweep(due)).includes(g) && sent.at(-1)!.text.includes("Try again later"));

  const fresh = new MemoryStore();
  const freshChat = await fresh.createInbox({
    orgId: ORG_ID, type: "nestchat", name: "Web", handle: "x.example.com", teamIds: ["team_support"], routingStrategy: "manual",
  });
  const freshAgent = (await fresh.getUser(nathan))!;
  const old = await fresh.upsertContactByIdentity({ orgId: ORG_ID, kind: "nestchat", value: "v_old", displayName: "Visitor" });
  await fresh.updateContact(old.id, { email: "old@example.com" } as never);
  const { conversation: oldConv } = await fresh.findOrCreateOpenConversation({
    orgId: ORG_ID, inboxId: freshChat.id, contact: (await fresh.getContact(old.id))!, channel: "nestchat",
  });
  const om = (await fresh.addMessage(oldConv.id, { body: "From before the deploy", internal: false }, freshAgent))!;
  await fresh.markOutboundStatusUpTo(oldConv.id, om.id, "delivered");
  const firstRun = new VisitorEmailService(fresh, mailer, new NestChatService(fresh, {} as VisitorBus), sandbox);
  const sentBefore = sent.length;
  ok("the first run doesn't email replies from before it existed",
    (await firstRun.sweep(due)).length === 0 && sent.length === sentBefore);

  console.log(failed === 0 ? "\nAll good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void runInTenant(ORG_ID, main);
