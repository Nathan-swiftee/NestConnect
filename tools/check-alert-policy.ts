/**
 * Who hears about a new message, and on which screen.
 *
 * Sibling to check-routing.ts and check-threading.ts. The web used to chime for
 * every message that arrived anywhere in the workspace, because the sound hung
 * off `message.created` — a broadcast to every open client, sent so that lists
 * and threads stay current whoever the message belongs to. On a shared inbox
 * that is a noise machine, and the way people deal with a noise machine is to
 * turn the sound off entirely, which is when they start missing the ones that
 * were theirs.
 *
 * The phone never had that problem: it has answered to a set of preferences all
 * along, with team-inbound off by default. So the desktop now takes its cue from
 * the same policy rather than from a second one written next to it.
 *
 * What is pinned here is that one rule, and the two ways it goes quietly wrong:
 *
 *   - Someone who has never installed the phone app has no device row. Reading
 *     the policy through the delivery path — which gives up early when there is
 *     nothing to push to — would decide they want nothing at all, and the web
 *     would go permanently silent for exactly the people who only use the web.
 *   - An inbox with no team attached routes to no assignee and no team. That
 *     used to notify nobody anywhere, which reads as "alerts are broken" rather
 *     than as a gap in routing.
 *
 *     pnpm check:alert-policy
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { PushService } from "../apps/api/src/push/push.service";
import type { PushProvider } from "../apps/api/src/push/push.provider";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { inboundAudience } from "../apps/api/src/channels/ingest.service";
import { DEFAULT_PUSH_PREFERENCES } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Who was cued on a screen, and who was pushed to a phone, for one send. */
interface Round {
  cued: string[];
  pushed: string[];
}

async function run(
  who: {
    userId: string;
    hasPhone?: boolean;
    /** Has this thread open in front of them. */
    viewing?: boolean;
    prefs?: Parameters<PushService["updatePreferences"]>[1];
  },
  req: Parameters<PushService["notifyAndWait"]>[0],
): Promise<Round> {
  const store = new MemoryStore();
  if (who.hasPhone !== false) {
    await store.upsertDevice({
      userId: who.userId,
      pushToken: `ExponentPushToken[${who.userId}]`,
      platform: "ios",
    });
  }

  const cued: string[] = [];
  const realtime = {
    emitMessageCue: (userIds: string[]) => cued.push(...userIds),
    isViewing: async () => who.viewing === true,
  } as unknown as RealtimeGateway;

  const pushed: string[] = [];
  const provider = {
    send: async (messages: { to: string }[]) => {
      pushed.push(...messages.map((m) => m.to));
      return messages.map((m) => ({ ok: true as const, to: m.to, ticketId: `t_${m.to}` }));
    },
  } as unknown as PushProvider;

  const svc = new PushService(store, provider, realtime);
  if (who.prefs) await svc.updatePreferences(who.userId, who.prefs);
  await svc.notifyAndWait(req);
  return { cued, pushed };
}

/** Send the same message N times through ONE service, so the per-instance rate
 *  limit actually accumulates the way it does in a running server. */
async function runBurst(times: number): Promise<{ cued: number; pushed: number }> {
  const store = new MemoryStore();
  await store.upsertDevice({ userId: "u_me", pushToken: "ExponentPushToken[u_me]", platform: "ios" });
  let cued = 0;
  let pushed = 0;
  const realtime = {
    emitMessageCue: (userIds: string[]) => {
      cued += userIds.length;
    },
    isViewing: async () => false,
  } as unknown as RealtimeGateway;
  const provider = {
    send: async (messages: { to: string }[]) => {
      pushed += messages.length;
      return messages.map((m) => ({ ok: true as const, to: m.to, ticketId: "t" }));
    },
  } as unknown as PushProvider;
  const svc = new PushService(store, provider, realtime);
  for (let i = 0; i < times; i++) await svc.notifyAndWait(inbound("message"));
  return { cued, pushed };
}

/** The message every case below is about, so each one differs only where it means to. */
const inbound = (kind: "message" | "team_message" | "mention" | "assignment" | "reminder", extra = {}) => ({
  userIds: ["u_me"],
  kind,
  title: "Marta",
  body: "Any update?",
  conversationId: "c1",
  ...extra,
});

async function main(): Promise<void> {
  console.log("\nA message on something assigned to me\n");
  let r = await run({ userId: "u_me" }, inbound("message"));
  ok("the screen is cued", r.cued.includes("u_me"));
  ok("and the phone is pushed", r.pushed.length === 1, `${r.pushed.length} push(es)`);

  console.log("\nSomebody else's conversation\n");
  // The whole point. team_message answers to `teamInbound`, which is off by
  // default — so the default workspace hears only what is its own.
  r = await run({ userId: "u_me" }, inbound("team_message"));
  ok("no sound by default", r.cued.length === 0, r.cued.join(", "));
  ok("and no push either", r.pushed.length === 0);
  ok("because team inbound ships off", DEFAULT_PUSH_PREFERENCES.teamInbound === false);

  r = await run({ userId: "u_me", prefs: { teamInbound: true } }, inbound("team_message"));
  ok("unless they asked for it", r.cued.includes("u_me"));

  console.log("\nSomebody who only uses the web\n");
  /*
   * The regression this file exists for. `deliver` gives up as soon as it finds
   * no devices, so evaluating the policy inside it would have made "has never
   * installed the app" mean "wants no alerts anywhere".
   */
  r = await run({ userId: "u_web", hasPhone: false }, { ...inbound("message"), userIds: ["u_web"] });
  ok("is still cued with no phone registered", r.cued.includes("u_web"));
  ok("and nothing is pushed, having nowhere to push", r.pushed.length === 0);

  console.log("\nThe sound is not an interruption, and does not answer to those rules\n");
  /*
   * The bug this section exists for. The desktop cue was first shipped reusing
   * the whole push policy, including the three rules that exist because a phone
   * banner interrupts: not while the thread is open in front of you, not during
   * quiet hours, and not more than five times a minute on one conversation.
   *
   * Every one of them is right for a banner and wrong for a sound. Together
   * they made the sound land sometimes and not others — which teaches people
   * that the app cannot be trusted to tell them, which is worse than no sound.
   */
  r = await run({ userId: "u_me", viewing: true }, inbound("message"));
  ok("a message in the thread I'm looking at still sounds", r.cued.includes("u_me"));
  ok("but doesn't also buzz the phone I'm holding", r.pushed.length === 0, `${r.pushed.length} push(es)`);

  // Quiet hours: a window covering the whole day, so it holds whenever this runs.
  const allNight = { quietHours: { start: "00:00", end: "23:59" } };
  r = await run({ userId: "u_me", prefs: allNight }, inbound("message"));
  ok("quiet hours hold the phone", r.pushed.length === 0);
  ok("and not the screen I'm sitting at", r.cued.includes("u_me"));

  // The sixth message in a minute on one thread. The rate limit lives on the
  // service instance, so this has to drive ONE of them repeatedly — eight
  // separate services would each start with a fresh count and prove nothing.
  const burst = await runBurst(8);
  ok("every message in a burst sounds", burst.cued === 8, `${burst.cued} of 8`);
  ok(
    "while the phone stops at the limit",
    burst.pushed === 5,
    // A conversation that goes silent after five replies is exactly the case
    // that reads as broken — on a screen. On a phone it is mercy.
    `${burst.pushed} push(es) of 8`,
  );

  console.log("\nThe things that should stay silent\n");
  r = await run({ userId: "u_me" }, inbound("message", { actorUserId: "u_me" }));
  ok("never about my own message", r.cued.length === 0 && r.pushed.length === 0);

  r = await run({ userId: "u_me", prefs: { mutedConversationIds: ["c1"] } }, inbound("message"));
  ok("nor a thread I muted", r.cued.length === 0, r.cued.join(", "));

  r = await run({ userId: "u_me", prefs: { assigned: false } }, inbound("message"));
  ok("nor anything I switched off", r.cued.length === 0);

  console.log("\nWho is told when a customer writes\n");
  const members = [
    { user: { id: "u_sales_1" }, teamIds: ["t_sales"] },
    { user: { id: "u_sales_2" }, teamIds: ["t_sales"] },
    { user: { id: "u_support" }, teamIds: ["t_support"] },
  ];
  const conv = (assigneeUserId: string | null, assignedTeamId: string | null) => ({
    assigneeUserId,
    assignedTeamId,
  });

  let who = inboundAudience(members, conv(null, "t_sales"));
  ok("an unassigned thread is its team's", who.team.join(",") === "u_sales_1,u_sales_2", who.team.join(", "));
  ok("with nobody named as its owner", who.assignee === null);

  /*
   * The bug this section grew for. An assigned conversation told its assignee
   * and stopped — `return`, not `else` — so somebody who had deliberately
   * switched "Everything in my team's inboxes" ON still heard nothing about
   * most of the workspace, because assigned is the normal state of an active
   * thread. The setting says "any new inbound in an inbox my team owns", and an
   * assigned one is still in the team's inbox.
   */
  who = inboundAudience(members, conv("u_sales_1", "t_sales"));
  ok("an assigned thread still reaches the rest of the team", who.team.includes("u_sales_2"));
  ok("and names its owner separately", who.assignee === "u_sales_1");
  // Two banners and two chimes for one message is its own bug.
  ok("who is not told twice", !who.team.includes("u_sales_1"), who.team.join(", "));
  ok("and nobody outside the team is told at all", !who.team.includes("u_support"));

  // An inbox nobody has attached a team to used to notify no one anywhere,
  // which reads as broken rather than as a gap in routing — and once the
  // desktop takes its cue from here, it would be a workspace with no sound.
  who = inboundAudience(members, conv(null, null));
  ok("an inbox with no team belongs to everyone, not to nobody", who.team.length === 3, `${who.team.length} of 3`);
  ok("and a team nobody is on reaches nobody", inboundAudience(members, conv(null, "t_empty")).team.length === 0);

  console.log("\nThe kinds that already have a sound of their own\n");
  // A mention and a snooze coming due reach the web through the bell, which
  // plays its own cue. Cueing them here as well would ring twice for one event.
  for (const kind of ["mention", "assignment", "reminder"] as const) {
    r = await run({ userId: "u_me" }, inbound(kind));
    ok(`${kind} pushes the phone but doesn't cue the screen`, r.cued.length === 0 && r.pushed.length === 1,
      `cued ${r.cued.length}, pushed ${r.pushed.length}`);
  }

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
