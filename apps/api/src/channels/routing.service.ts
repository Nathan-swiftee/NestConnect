import { Injectable, Optional } from "@nestjs/common";
import { availableNow, routingAccount, type Contact, type Inbox } from "@ding/schemas";
import { AccountsService } from "../accounts/accounts.service";
import { Store } from "../data/store";

export interface RoutingDecision {
  assigneeUserId: string | null;
  assignedTeamId: string | null;
  /** Why — for the conversation log. */
  reason?: "menu" | "outreach" | "contact" | "organisation" | "channel";
  /** The organisation that decided, when one did. */
  organisation?: string;
}

/** How long after an agent's outreach the customer's answer still goes back to them. */
export const OUTREACH_WINDOW_DAYS = 14;

export interface RoutingHints {
  /**
   * The team a visitor asked for by picking an option on a NestChat pre-chat
   * form ("Billing", "New business"). Already checked against the channel's own
   * teams by the time it gets here — see `NestChatService.resolveOption`.
   */
  optionTeamId?: string | null;
}

/**
 * Decides who a newly-created conversation goes to.
 *   0. Back to the agent who wrote to them, when this is the customer answering
 *      an agent's outreach (Compose) whose thread was closed before they did —
 *      while that agent is available (see `OUTREACH_WINDOW_DAYS`)
 *   1. A team the customer explicitly asked for (the NestChat routing menu)
 *   2. Per-customer owner (a client always reaches "their" person/team)
 *   3. Their organisation's routing — the one organisation they're in, or the
 *      only one of theirs that has routing set (see `routingAccount`). A
 *      contact's own routing, team or person, always wins over it.
 *   4. Otherwise the inbox's owning team + its strategy:
 *      - manual        → stays unassigned (in the "Queue")
 *      - round_robin / load_balanced / most_idle → assign an available agent
 * (The latter three share a simple rotation in Phase 1; refine per strategy later.)
 *
 * The explicit ask sits above the owner deliberately. The owner is a fact about
 * the *relationship*; the option is a fact about *this conversation*, chosen
 * seconds ago by the person starting it. Someone who picks "Billing" and lands
 * with their account manager has been ignored, and they can tell.
 *
 * What survives of the owner is the part that costs nothing: if they are on the
 * team that was asked for, they get it. The customer reaches billing, and
 * billing turns out to be the person who already knows them.
 *
 * Nobody is handed a chat while they're unavailable — switched off, or outside
 * the working hours they set (`availableNow`). That includes a customer's own
 * person: their chat goes to the team instead of waiting on somebody who is
 * away, which is the one thing the customer would notice.
 */
@Injectable()
export class RoutingService {
  private rotation = 0;

  constructor(
    private readonly store: Store,
    // Optional so the routing checks can build this without organisations.
    @Optional() private readonly accounts?: AccountsService,
  ) {}

  async route(inbox: Inbox, contact: Contact, hints?: RoutingHints): Promise<RoutingDecision> {
    const asked = hints?.optionTeamId;
    if (asked) return { ...(await this.decide(inbox, contact, hints)), reason: "menu" };
    const back = await this.outreachRoute(inbox, contact);
    if (back) return back;
    if (contact.ownerUserId || contact.ownerTeamId) return { ...(await this.decide(inbox, contact, hints)), reason: "contact" };
    const decision = await this.decide(inbox, contact, hints);
    return decision.reason ? decision : { ...decision, reason: "channel" };
  }

  private async decide(inbox: Inbox, contact: Contact, hints?: RoutingHints): Promise<RoutingDecision> {
    const asked = hints?.optionTeamId;
    if (asked) {
      // Their own person, but only when they're one of the people who answer
      // what was asked for. Otherwise the team takes it on its own terms.
      if (
        contact.ownerUserId &&
        (await this.isMember(asked, contact.ownerUserId)) &&
        (await this.isAvailable(contact.ownerUserId))
      ) {
        return { assigneeUserId: contact.ownerUserId, assignedTeamId: asked };
      }
      // Likewise their organisation's person, if nobody of their own is set.
      const org = contact.ownerUserId || contact.ownerTeamId ? null : await this.organisationRoute(contact);
      if (org?.userId && (await this.isMember(asked, org.userId)) && (await this.isAvailable(org.userId))) {
        return { assigneeUserId: org.userId, assignedTeamId: asked };
      }
      return this.withinTeam(inbox, asked);
    }

    if (contact.ownerUserId) {
      const team = contact.ownerTeamId ?? inbox.teamIds[0] ?? null;
      if (await this.isAvailable(contact.ownerUserId)) {
        return { assigneeUserId: contact.ownerUserId, assignedTeamId: team };
      }
      // Their person is away: the team takes it rather than it waiting.
      return this.withinTeam(inbox, team);
    }
    if (contact.ownerTeamId) {
      return { assigneeUserId: null, assignedTeamId: contact.ownerTeamId };
    }

    const org = await this.organisationRoute(contact);
    if (org) {
      // Their organisation's person, while they're available and still on the
      // team; otherwise the team takes it, by the channel's strategy.
      const via = { reason: "organisation" as const, organisation: org.name };
      if (org.userId && (await this.isMember(org.teamId, org.userId)) && (await this.isAvailable(org.userId))) {
        return { assigneeUserId: org.userId, assignedTeamId: org.teamId, ...via };
      }
      return { ...(await this.withinTeam(inbox, org.teamId)), ...via };
    }

    return this.withinTeam(inbox, inbox.teamIds[0] ?? null);
  }

  /**
   * An agent started this — wrote to the customer from Compose — and the
   * thread was closed before the customer answered. The answer is theirs: it
   * goes back to the agent who asked, not into the team's queue, as long as
   * they're available to take it. (While the thread is still open the answer
   * simply lands in it, already theirs; this is for the one that was closed.)
   */
  private async outreachRoute(inbox: Inbox, contact: Contact): Promise<RoutingDecision | null> {
    const since = new Date(Date.now() - OUTREACH_WINDOW_DAYS * 86_400_000).toISOString();
    const sent = await this.store.findRecentOutreach({ orgId: inbox.orgId, inboxId: inbox.id, contactId: contact.id, since });
    if (!sent || !(await this.isAvailable(sent.userId))) return null;
    return { assigneeUserId: sent.userId, assignedTeamId: sent.teamId ?? inbox.teamIds[0] ?? null, reason: "outreach" };
  }

  /** The organisation that decides for this contact, if one does, and its team still exists. */
  private async organisationRoute(contact: Contact): Promise<{ teamId: string; userId: string | null; name: string } | null> {
    if (!this.accounts) return null;
    const { account } = routingAccount(await this.accounts.routingCandidates(contact.id));
    if (!account?.routeTeamId || !(await this.store.getTeam(account.routeTeamId))) return null;
    return { teamId: account.routeTeamId, userId: account.routeUserId, name: account.name };
  }

  /** Pick somebody on this team, per the inbox's strategy. */
  private async withinTeam(inbox: Inbox, teamId: string | null): Promise<RoutingDecision> {
    if (!teamId || inbox.routingStrategy === "manual") {
      return { assigneeUserId: null, assignedTeamId: teamId };
    }

    const members = await this.store.getMembers(teamId);
    // Only agents available right now take auto-assignments — switched on and
    // inside their working hours. Among those, prefer the ones currently online.
    // If nobody is available, leave it unassigned in the team's queue rather
    // than handing it to someone who's out.
    const now = new Date();
    const available = members.filter((m) => availableNow(m, now));
    const online = available.filter((m) => m.online);
    const pool = online.length ? online : available;
    if (!pool.length) return { assigneeUserId: null, assignedTeamId: teamId };

    const pick = pool[this.rotation++ % pool.length];
    return { assigneeUserId: pick.id, assignedTeamId: teamId };
  }

  private async isAvailable(userId: string): Promise<boolean> {
    const user = await this.store.getUser(userId);
    return Boolean(user && availableNow(user));
  }

  private async isMember(teamId: string, userId: string): Promise<boolean> {
    const members = await this.store.getMembers(teamId);
    return members.some((m) => m.id === userId);
  }
}
