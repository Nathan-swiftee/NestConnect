import { Injectable } from "@nestjs/common";
import type { Contact, Inbox } from "@ding/schemas";
import { Store } from "../data/store";

export interface RoutingDecision {
  assigneeUserId: string | null;
  assignedTeamId: string | null;
}

/**
 * Decides who a newly-created conversation goes to.
 *   1. Per-customer owner (a client always reaches "their" person/team)
 *   2. Otherwise the inbox's owning team + its strategy:
 *      - manual        → stays unassigned (in the "Queue")
 *      - round_robin / load_balanced / most_idle → assign an available agent
 * (The latter three share a simple rotation in Phase 1; refine per strategy later.)
 */
@Injectable()
export class RoutingService {
  private rotation = 0;

  constructor(private readonly store: Store) {}

  async route(inbox: Inbox, contact: Contact): Promise<RoutingDecision> {
    if (contact.ownerUserId) {
      return { assigneeUserId: contact.ownerUserId, assignedTeamId: contact.ownerTeamId ?? inbox.teamIds[0] ?? null };
    }
    if (contact.ownerTeamId) {
      return { assigneeUserId: null, assignedTeamId: contact.ownerTeamId };
    }

    const teamId = inbox.teamIds[0] ?? null;
    if (!teamId || inbox.routingStrategy === "manual") {
      return { assigneeUserId: null, assignedTeamId: teamId };
    }

    const members = await this.store.getMembers(teamId);
    const online = members.filter((m) => m.online);
    const pool = online.length ? online : members;
    if (!pool.length) return { assigneeUserId: null, assignedTeamId: teamId };

    const pick = pool[this.rotation++ % pool.length];
    return { assigneeUserId: pick.id, assignedTeamId: teamId };
  }
}
