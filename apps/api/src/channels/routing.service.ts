import { Injectable } from "@nestjs/common";
import type { Contact, Inbox } from "@ding/schemas";
import { Store } from "../data/store";

export interface RoutingDecision {
  assigneeUserId: string | null;
  assignedTeamId: string | null;
}

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
 *   1. A team the customer explicitly asked for (the NestChat routing menu)
 *   2. Per-customer owner (a client always reaches "their" person/team)
 *   3. Otherwise the inbox's owning team + its strategy:
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
 */
@Injectable()
export class RoutingService {
  private rotation = 0;

  constructor(private readonly store: Store) {}

  async route(inbox: Inbox, contact: Contact, hints?: RoutingHints): Promise<RoutingDecision> {
    const asked = hints?.optionTeamId;
    if (asked) {
      // Their own person, but only when they're one of the people who answer
      // what was asked for. Otherwise the team takes it on its own terms.
      if (contact.ownerUserId && (await this.isMember(asked, contact.ownerUserId))) {
        return { assigneeUserId: contact.ownerUserId, assignedTeamId: asked };
      }
      return this.withinTeam(inbox, asked);
    }

    if (contact.ownerUserId) {
      return { assigneeUserId: contact.ownerUserId, assignedTeamId: contact.ownerTeamId ?? inbox.teamIds[0] ?? null };
    }
    if (contact.ownerTeamId) {
      return { assigneeUserId: null, assignedTeamId: contact.ownerTeamId };
    }

    return this.withinTeam(inbox, inbox.teamIds[0] ?? null);
  }

  /** Pick somebody on this team, per the inbox's strategy. */
  private async withinTeam(inbox: Inbox, teamId: string | null): Promise<RoutingDecision> {
    if (!teamId || inbox.routingStrategy === "manual") {
      return { assigneeUserId: null, assignedTeamId: teamId };
    }

    const members = await this.store.getMembers(teamId);
    // Only agents who've marked themselves available take auto-assignments; among
    // those, prefer the ones currently online. If nobody is available, leave it
    // unassigned in the team's queue rather than handing it to someone who's out.
    const available = members.filter((m) => m.available !== false);
    const online = available.filter((m) => m.online);
    const pool = online.length ? online : available;
    if (!pool.length) return { assigneeUserId: null, assignedTeamId: teamId };

    const pick = pool[this.rotation++ % pool.length];
    return { assigneeUserId: pick.id, assignedTeamId: teamId };
  }

  private async isMember(teamId: string, userId: string): Promise<boolean> {
    const members = await this.store.getMembers(teamId);
    return members.some((m) => m.id === userId);
  }
}
