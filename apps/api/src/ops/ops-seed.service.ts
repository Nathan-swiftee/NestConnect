import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { nextReviewDue, opsSopInputSchema, type Member, type OpsActor } from "@ding/schemas";
import { sanitizeKnowledgeHtml } from "../accounts/knowledge-html";
import { env } from "../config/env";
import { Store } from "../data/store";
import { PLATFORM_ORG_ID } from "../tenancy/platform";
import { runInTenant } from "../tenancy/tenant-scope";
import { OpsStore } from "./ops.store";
import { ACCOUNTS_COLLECTION, ACCOUNTS_SOPS, ACCOUNTS_SOPS_OWNER, ACCOUNTS_SOPS_SEED_KEY } from "./seed/accounts-sops";

/** Teams an Accounts SOP is for. */
const ACCOUNTS_TEAM = /\b(accounts?|accounting|finance|credit control)\b/i;

export type SeedOutcome = "added" | "done-before" | "no-one-to-write-it";

/**
 * Adds the Accounts team's SOPs (seed/accounts-sops.ts) to the operator's own
 * workspace, once. Published for the Accounts/Finance team when there is one;
 * left as drafts for an editor to aim at a team when there isn't. An SOP with
 * the same title already there is left alone, and once it has run it never
 * runs again — deleting one afterwards doesn't bring it back.
 *
 * It writes whether or not Business Ops is switched on, so they're waiting
 * when it is.
 */
@Injectable()
export class OpsSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OpsSeedService.name);

  constructor(
    private readonly ops: OpsStore,
    private readonly store: Store,
  ) {}

  onApplicationBootstrap(): void {
    // Real workspaces only: the in-memory demo has its own sample SOPs.
    if (!env.usingDatabase) return;
    void this.seedAccountsSops().catch((err) => this.logger.warn(`Accounts SOPs not added: ${String(err)}`));
  }

  async seedAccountsSops(orgId = PLATFORM_ORG_ID): Promise<SeedOutcome> {
    return runInTenant(orgId, async () => {
      if (await this.store.getAppSetting(orgId, ACCOUNTS_SOPS_SEED_KEY)) return "done-before";

      const members = await this.store.listMembers();
      const owner = members.find(
        (m) => m.user.email?.toLowerCase() === ACCOUNTS_SOPS_OWNER.email || m.user.name.trim().toLowerCase() === ACCOUNTS_SOPS_OWNER.name.toLowerCase(),
      );
      const writer = [owner, ...members.filter((m) => m.user.role === "admin"), ...members.filter((m) => m.user.role === "manager")].find(
        (m): m is Member => !!m && (m.user.role === "admin" || m.user.role === "manager"),
      );
      // Nobody who could have written them: try again on the next start.
      if (!writer) {
        this.logger.warn("Accounts SOPs not added yet: no admin or manager in the workspace");
        return "no-one-to-write-it";
      }
      const by: OpsActor = { id: writer.user.id, name: writer.user.name };
      const ownedBy: OpsActor = owner ? { id: owner.user.id, name: owner.user.name } : by;

      const teamIds = (await this.store.listTeams()).filter((t) => ACCOUNTS_TEAM.test(t.name)).map((t) => t.id);
      const collection =
        (await this.ops.collectionByName(ACCOUNTS_COLLECTION.name)) ?? (await this.ops.createCollection(ACCOUNTS_COLLECTION));
      const existing = new Set((await this.ops.listSops()).map((s) => s.title.trim().toLowerCase()));

      const added: string[] = [];
      for (const raw of ACCOUNTS_SOPS) {
        const input = opsSopInputSchema.parse(raw);
        if (existing.has(input.title.toLowerCase())) continue;
        const sop = await this.ops.createSop(
          {
            collectionId: collection.id,
            title: input.title,
            icon: input.icon,
            color: input.color,
            summary: input.summary,
            warnings: input.warnings,
            steps: input.steps.map((s) => ({ text: s.text.trim(), imageUrl: s.imageUrl || null, link: s.link || null })),
            body: sanitizeKnowledgeHtml(input.body),
            resources: input.resources.map((r) => ({ id: `res_${randomBytes(6).toString("hex")}`, kind: r.kind, title: r.title, url: r.url })),
            teamIds,
            allTeams: false,
            mustRead: false,
            reviewEveryMonths: 12,
            owner: ownedBy,
            status: "draft",
            version: 0,
            reviewDueAt: null,
            reviewNotifiedAt: null,
            lastReviewedAt: null,
            publishedAt: null,
          },
          by,
        );
        if (teamIds.length) {
          // As OpsService.publish does: version 1, with its revision.
          const now = new Date().toISOString();
          await this.ops.addRevision(sop.id, {
            version: 1,
            title: sop.title,
            summary: sop.summary,
            warnings: sop.warnings,
            steps: sop.steps,
            body: sop.body,
            note: "First version, from the Accounts team's SOP document",
            publishedAt: now,
            publishedBy: by,
          });
          await this.ops.updateSop(
            sop.id,
            { status: "published", version: 1, publishedAt: now, lastReviewedAt: now, reviewDueAt: nextReviewDue(now, sop.reviewEveryMonths) },
            by,
          );
        }
        added.push(sop.title);
      }

      await this.store.setAppSetting(orgId, ACCOUNTS_SOPS_SEED_KEY, new Date().toISOString());
      this.logger.log(
        added.length
          ? `Accounts SOPs added (${added.join(", ")}) — ${teamIds.length ? "published for the Accounts team" : "as drafts: no Accounts or Finance team to publish them for"}`
          : "Accounts SOPs already there",
      );
      return "added";
    });
  }
}
