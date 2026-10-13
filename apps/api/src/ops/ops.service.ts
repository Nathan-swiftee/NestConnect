import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  nextReviewDue,
  type Member,
  type OpsAckReport,
  type OpsActor,
  type OpsCollection,
  type OpsCollectionInput,
  type OpsLibrary,
  type OpsRevision,
  type OpsSop,
  type OpsSopCard,
  type OpsSopInput,
  type OpsStatusInfo,
  type PublishOpsSopInput,
  type UpdateOpsSopInput,
  type User,
} from "@ding/schemas";
import { knowledgeText, sanitizeKnowledgeHtml } from "../accounts/knowledge-html";
import { Store } from "../data/store";
import { NotificationsService } from "../notifications/notifications.service";
import { currentOrgId, runInTenant } from "../tenancy/tenant-scope";
import { OpsStore, type OpsAckRecord, type OpsSopFields, type OpsSopRecord } from "./ops.store";

/** The workspace setting that switches the module on. Off unless set. */
export const OPS_MODULE_KEY = "module.business_ops";
/** How often owners are checked for SOPs that have come due for review. */
const REVIEW_SWEEP_MS = 10 * 60_000;

/** Who is asking, and what that lets them see. */
interface Viewer {
  user: User;
  teamIds: string[];
  /** Admins and managers write SOPs and see every one, drafts included. */
  canEdit: boolean;
}

/**
 * Business Ops: the workspace's own SOPs. Who sees which (an SOP's teams, or
 * every team; editors see everything), publishing and its versions, read
 * confirmations, personal checklists and review reminders — and the switch
 * that turns all of it off. See docs/business-ops.md.
 */
@Injectable()
export class OpsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OpsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ops: OpsStore,
    private readonly store: Store,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweepReviews(), REVIEW_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ---- the switch ---- */

  async enabled(): Promise<boolean> {
    return (await this.store.getAppSetting(currentOrgId(), OPS_MODULE_KEY)) === "on";
  }

  /** Whether the module is on, whether I write SOPs, and my waiting must-reads. */
  async status(userId: string): Promise<OpsStatusInfo> {
    const viewer = await this.viewer(userId);
    if (!(await this.enabled())) return { enabled: false, canEdit: viewer.canEdit, pendingAcks: 0 };
    const [sops, acks] = await Promise.all([this.ops.listSops(), this.ops.acksForUser(userId)]);
    const mine = new Map(acks.map((a) => [a.opsSopId, a]));
    const pendingAcks = sops.filter((s) => this.needsAck(s, viewer, mine.get(s.id))).length;
    return { enabled: true, canEdit: viewer.canEdit, pendingAcks };
  }

  /** Admins only. Switching off hides it and keeps everything for switching back on. */
  async setEnabled(userId: string, enabled: boolean): Promise<OpsStatusInfo> {
    const user = await this.store.getUser(userId);
    if (user?.role !== "admin") throw new ForbiddenException("Only an admin can switch modules on or off");
    await this.store.setAppSetting(currentOrgId(), OPS_MODULE_KEY, enabled ? "on" : "off");
    return this.status(userId);
  }

  /* ---- reading ---- */

  async library(userId: string, q?: string): Promise<OpsLibrary> {
    const viewer = await this.open(userId);
    const [all, collections, acks] = await Promise.all([
      this.ops.listSops(),
      this.ops.listCollections(),
      this.ops.acksForUser(userId),
    ]);
    const mine = new Map(acks.map((a) => [a.opsSopId, a]));
    const terms = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const visible = all.filter((s) => this.canRead(s, viewer));
    const sops = visible
      .filter((s) => !terms.length || matches(s, terms))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }))
      .map((s) => this.card(s, viewer, mine.get(s.id)));
    const counts = new Map<string, number>();
    for (const s of visible) if (s.collectionId && s.status !== "archived") counts.set(s.collectionId, (counts.get(s.collectionId) ?? 0) + 1);
    const out: OpsCollection[] = collections.map((c) => ({ ...c, sopCount: counts.get(c.id) ?? 0 }));
    return { collections: out, sops };
  }

  async get(userId: string, id: string): Promise<OpsSop> {
    const viewer = await this.open(userId);
    const sop = await this.readable(id, viewer);
    const [acks, checklist] = await Promise.all([this.ops.acksForUser(userId), this.ops.getChecklist(id, userId)]);
    return this.full(sop, viewer, acks.find((a) => a.opsSopId === id), checklist);
  }

  /** Every published version, newest first. Whoever can read the SOP can see its history. */
  async versions(userId: string, id: string): Promise<OpsRevision[]> {
    const viewer = await this.open(userId);
    await this.readable(id, viewer);
    return this.ops.listRevisions(id);
  }

  /* ---- writing (admins and managers) ---- */

  async create(userId: string, input: OpsSopInput): Promise<OpsSop> {
    const viewer = await this.editor(userId);
    const by = actor(viewer.user);
    const clean = await this.clean(input as UpdateOpsSopInput);
    const fields: OpsSopFields = {
      collectionId: null,
      title: "",
      icon: "📘",
      color: "#0FA47A",
      summary: "",
      warnings: "",
      steps: [],
      body: "",
      resources: [],
      teamIds: [],
      allTeams: false,
      mustRead: false,
      reviewEveryMonths: null,
      owner: by,
      ...clean,
      status: "draft",
      version: 0,
      reviewDueAt: null,
      reviewNotifiedAt: null,
      lastReviewedAt: null,
      publishedAt: null,
    };
    const sop = await this.ops.createSop(fields, by);
    return this.full(sop, viewer, undefined, []);
  }

  /**
   * Save changes. On a published SOP they're live straight away — a typo fix
   * shouldn't need a new version. Publishing again is what makes a version,
   * and what asks must-read readers to confirm it.
   */
  async update(userId: string, id: string, input: UpdateOpsSopInput): Promise<OpsSop> {
    const viewer = await this.editor(userId);
    const sop = await this.mustGet(id);
    const patch: Partial<OpsSopFields> = await this.clean(input);
    if (patch.reviewEveryMonths !== undefined && patch.reviewEveryMonths !== sop.reviewEveryMonths) {
      Object.assign(patch, this.reviewDates(sop, patch.reviewEveryMonths));
    }
    const saved = await this.ops.updateSop(id, patch, actor(viewer.user));
    return this.reload(saved, viewer);
  }

  async publish(userId: string, id: string, input: PublishOpsSopInput): Promise<OpsSop> {
    const viewer = await this.editor(userId);
    const sop = await this.mustGet(id);
    if (!sop.steps.length && !knowledgeText(sop.body)) {
      throw new BadRequestException("Add at least one step or some details before publishing");
    }
    if (!sop.allTeams && !sop.teamIds.length) {
      throw new BadRequestException("Choose which teams can read it — or All teams — before publishing");
    }
    const now = new Date();
    const by = actor(viewer.user);
    const version = sop.version + 1;
    await this.ops.addRevision(id, {
      version,
      title: sop.title,
      summary: sop.summary,
      warnings: sop.warnings,
      steps: sop.steps,
      body: sop.body,
      note: input.note ?? "",
      publishedAt: now.toISOString(),
      publishedBy: by,
    });
    const saved = await this.ops.updateSop(
      id,
      {
        status: "published",
        version,
        publishedAt: now.toISOString(),
        // A publish is a review: the clock starts again from now.
        lastReviewedAt: now.toISOString(),
        reviewDueAt: nextReviewDue(now, sop.reviewEveryMonths),
        reviewNotifiedAt: null,
      },
      by,
    );
    if (saved?.mustRead) await this.announceMustRead(saved, viewer.user);
    return this.reload(saved, viewer);
  }

  /** Out of the library for readers; kept, with its history, for editors. */
  async archive(userId: string, id: string): Promise<OpsSop> {
    const viewer = await this.editor(userId);
    await this.mustGet(id);
    return this.reload(await this.ops.updateSop(id, { status: "archived" }, actor(viewer.user)), viewer);
  }

  /** Back to how it was before archiving: published if it ever was, else a draft. */
  async restore(userId: string, id: string): Promise<OpsSop> {
    const viewer = await this.editor(userId);
    const sop = await this.mustGet(id);
    const status = sop.version > 0 ? "published" : "draft";
    return this.reload(await this.ops.updateSop(id, { status }, actor(viewer.user)), viewer);
  }

  /** "Still right": the review is done and the next one is due a period from now. */
  async markReviewed(userId: string, id: string): Promise<OpsSop> {
    const viewer = await this.editor(userId);
    const sop = await this.mustGet(id);
    const now = new Date();
    const saved = await this.ops.updateSop(
      id,
      {
        lastReviewedAt: now.toISOString(),
        reviewDueAt: sop.status === "published" ? nextReviewDue(now, sop.reviewEveryMonths) : null,
        reviewNotifiedAt: null,
      },
      actor(viewer.user),
    );
    return this.reload(saved, viewer);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.editor(userId);
    if (!(await this.ops.removeSop(id))) throw new NotFoundException("SOP not found");
  }

  /* ---- collections ---- */

  async createCollection(userId: string, input: OpsCollectionInput): Promise<OpsCollection> {
    await this.editor(userId);
    const name = input.name.trim();
    if (await this.ops.collectionByName(name)) throw new ConflictException(`There's already a collection called “${name}”`);
    const c = await this.ops.createCollection({ name, icon: input.icon ?? "📁", color: input.color ?? "#0FA47A" });
    return { ...c, sopCount: 0 };
  }

  async updateCollection(userId: string, id: string, input: Partial<OpsCollectionInput> & { order?: number }): Promise<OpsCollection> {
    await this.editor(userId);
    if (input.name) {
      const taken = await this.ops.collectionByName(input.name.trim());
      if (taken && taken.id !== id) throw new ConflictException(`There's already a collection called “${input.name.trim()}”`);
    }
    const c = await this.ops.updateCollection(id, { name: input.name?.trim(), icon: input.icon, color: input.color, order: input.order });
    if (!c) throw new NotFoundException("Collection not found");
    const count = (await this.ops.listSops()).filter((s) => s.collectionId === id && s.status !== "archived").length;
    return { ...c, sopCount: count };
  }

  async removeCollection(userId: string, id: string): Promise<void> {
    await this.editor(userId);
    if (!(await this.ops.removeCollection(id))) throw new NotFoundException("Collection not found");
  }

  /* ---- read confirmation ---- */

  /** "I've read this" — for the version that's published now. */
  async acknowledge(userId: string, id: string): Promise<OpsSop> {
    const viewer = await this.open(userId);
    const sop = await this.readable(id, viewer);
    if (sop.status !== "published") throw new BadRequestException("Only a published SOP can be confirmed");
    const ack = await this.ops.setAck(id, userId, sop.version);
    return this.full(sop, viewer, ack, await this.ops.getChecklist(id, userId));
  }

  /** Who has and hasn't confirmed a must-read: everyone in its teams. For editors. */
  async ackReport(userId: string, id: string): Promise<OpsAckReport> {
    await this.editor(userId);
    const sop = await this.mustGet(id);
    const [members, acks] = await Promise.all([this.store.listMembers(), this.ops.acksForSop(id)]);
    const byUser = new Map(acks.map((a) => [a.userId, a]));
    const people = this.audience(sop, members)
      .map((m) => {
        const a = byUser.get(m.user.id);
        return {
          userId: m.user.id,
          name: m.user.name,
          avatarColor: m.user.avatarColor ?? null,
          avatarUrl: m.user.avatarUrl ?? null,
          ackedVersion: a?.version ?? null,
          ackedAt: a?.at ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { version: sop.version, people };
  }

  /* ---- my checklist ---- */

  async setChecklist(userId: string, id: string, done: number[]): Promise<number[]> {
    const viewer = await this.open(userId);
    const sop = await this.readable(id, viewer);
    if (done.some((i) => i >= sop.steps.length)) throw new BadRequestException("That step doesn't exist");
    return this.ops.setChecklist(id, userId, done);
  }

  /* ---- review reminders ---- */

  /** Tell each owner once when an SOP of theirs comes due for review. */
  async sweepReviews(now = new Date()): Promise<number> {
    let sent = 0;
    try {
      const due = await this.ops.reviewsDueAcrossWorkspaces(now);
      for (const { id, orgId } of due) {
        await runInTenant(orgId, async () => {
          if (!(await this.enabled())) return;
          const sop = await this.ops.getSop(id);
          if (!sop) return;
          // Nobody to tell: left for whoever opens it — it shows as due anyway.
          const ownerId = sop.owner?.id;
          const owner = ownerId ? await this.store.getUser(ownerId) : undefined;
          await this.ops.updateSop(id, { reviewNotifiedAt: now.toISOString() });
          if (!owner) return;
          await this.notifications.create(owner.id, {
            type: "ops_review",
            title: "SOP due for review",
            body: `${sop.icon} ${sop.title}`,
            opsSopId: sop.id,
          });
          sent++;
        });
      }
    } catch (err) {
      this.logger.warn(`Ops review sweep failed: ${String(err)}`);
    }
    return sent;
  }

  /* ---- internals ---- */

  private async viewer(userId: string): Promise<Viewer> {
    const user = await this.store.getUser(userId);
    if (!user) throw new ForbiddenException("Not signed in");
    const teamIds = await this.store.teamsForUser(userId);
    return { user, teamIds, canEdit: user.role === "admin" || user.role === "manager" };
  }

  /** Anyone, with the module on. Off, there is nothing here to find. */
  private async open(userId: string): Promise<Viewer> {
    if (!(await this.enabled())) throw new NotFoundException("Business Ops is switched off");
    return this.viewer(userId);
  }

  private async editor(userId: string): Promise<Viewer> {
    const viewer = await this.open(userId);
    if (!viewer.canEdit) throw new ForbiddenException("Only a manager or admin can change SOPs");
    return viewer;
  }

  /** One of its teams, or every team. */
  private inAudience(sop: OpsSopRecord, teamIds: string[]): boolean {
    return sop.allTeams || sop.teamIds.some((t) => teamIds.includes(t));
  }

  private canRead(sop: OpsSopRecord, viewer: Viewer): boolean {
    return viewer.canEdit || (sop.status === "published" && this.inAudience(sop, viewer.teamIds));
  }

  /** The people a must-read is for: its teams' members (everyone, for All teams). */
  private audience(sop: OpsSopRecord, members: Member[]): Member[] {
    return members.filter((m) => this.inAudience(sop, m.teamIds));
  }

  private needsAck(sop: OpsSopRecord, viewer: Viewer, ack?: OpsAckRecord): boolean {
    return (
      sop.mustRead &&
      sop.status === "published" &&
      this.inAudience(sop, viewer.teamIds) &&
      (ack?.version ?? 0) < sop.version
    );
  }

  /** Not found unless it exists *and* I may read it — a reader can't learn a draft's id is real. */
  private async readable(id: string, viewer: Viewer): Promise<OpsSopRecord> {
    const sop = await this.ops.getSop(id);
    if (!sop || !this.canRead(sop, viewer)) throw new NotFoundException("SOP not found");
    return sop;
  }

  private async mustGet(id: string): Promise<OpsSopRecord> {
    const sop = await this.ops.getSop(id);
    if (!sop) throw new NotFoundException("SOP not found");
    return sop;
  }

  private async reload(sop: OpsSopRecord | undefined, viewer: Viewer): Promise<OpsSop> {
    if (!sop) throw new NotFoundException("SOP not found");
    const uid = viewer.user.id;
    const [acks, checklist] = await Promise.all([this.ops.acksForUser(uid), this.ops.getChecklist(sop.id, uid)]);
    return this.full(sop, viewer, acks.find((a) => a.opsSopId === sop.id), checklist);
  }

  private card(s: OpsSopRecord, viewer: Viewer, ack?: OpsAckRecord): OpsSopCard {
    return {
      id: s.id,
      title: s.title,
      icon: s.icon,
      color: s.color,
      summary: s.summary,
      collectionId: s.collectionId,
      teamIds: s.teamIds,
      allTeams: s.allTeams,
      status: s.status,
      version: s.version,
      stepCount: s.steps.length,
      mustRead: s.mustRead,
      needsMyAck: this.needsAck(s, viewer, ack),
      reviewDueAt: s.reviewDueAt,
      reviewOverdue: s.status === "published" && !!s.reviewDueAt && new Date(s.reviewDueAt) <= new Date(),
      owner: s.owner,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
      publishedAt: s.publishedAt,
    };
  }

  private full(s: OpsSopRecord, viewer: Viewer, ack: OpsAckRecord | undefined, checklist: number[]): OpsSop {
    return {
      ...this.card(s, viewer, ack),
      warnings: s.warnings,
      steps: s.steps,
      body: s.body,
      resources: s.resources,
      reviewEveryMonths: s.reviewEveryMonths,
      lastReviewedAt: s.lastReviewedAt,
      myAck: ack ? { version: ack.version, at: ack.at } : null,
      // A step removed since: its tick goes with it.
      myChecklist: checklist.filter((i) => i < s.steps.length),
    };
  }

  /** A changed review period: due a period after the last review (or publish). */
  private reviewDates(sop: OpsSopRecord, months: number | null): Partial<OpsSopFields> {
    if (sop.status !== "published" || !months) return { reviewDueAt: null, reviewNotifiedAt: null };
    const from = sop.lastReviewedAt ?? sop.publishedAt ?? new Date().toISOString();
    return { reviewDueAt: nextReviewDue(from, months), reviewNotifiedAt: null };
  }

  /**
   * An input as stored fields: cleaned, and checked against this workspace —
   * its teams, collections and people. The Postgres store would refuse a
   * stranger's id anyway; this says which, in words.
   */
  private async clean(input: UpdateOpsSopInput): Promise<Partial<OpsSopFields>> {
    const out: Partial<OpsSopFields> = {};
    const plain = ["title", "icon", "color", "summary", "warnings", "allTeams", "mustRead", "reviewEveryMonths"] as const;
    for (const k of plain) if (input[k] !== undefined) (out as Record<string, unknown>)[k] = input[k];
    if (input.body !== undefined) out.body = sanitizeKnowledgeHtml(input.body);
    if (input.steps !== undefined) {
      out.steps = input.steps.map((s) => ({ text: s.text.trim(), imageUrl: s.imageUrl || null, link: s.link || null }));
    }
    if (input.resources !== undefined) {
      out.resources = input.resources.map((r) => ({ id: `res_${randomBytes(6).toString("hex")}`, kind: r.kind, title: r.title, url: r.url }));
    }
    if (input.teamIds !== undefined) {
      const ids = [...new Set(input.teamIds)];
      const known = new Set((await this.store.listTeams()).map((t) => t.id));
      if (ids.some((t) => !known.has(t))) throw new BadRequestException("One of those teams doesn't exist");
      out.teamIds = ids;
    }
    if (input.collectionId !== undefined) {
      if (input.collectionId && !(await this.ops.getCollection(input.collectionId))) {
        throw new BadRequestException("That collection doesn't exist");
      }
      out.collectionId = input.collectionId || null;
    }
    if (input.ownerUserId !== undefined) {
      if (!input.ownerUserId) out.owner = null;
      else {
        const owner = await this.store.getUser(input.ownerUserId);
        if (!owner) throw new BadRequestException("That person isn't in this workspace");
        out.owner = actor(owner);
      }
    }
    return out;
  }

  /** A new version of a must-read: everyone it's for is asked to read it. */
  private async announceMustRead(sop: OpsSopRecord, by: User): Promise<void> {
    const members = await this.store.listMembers();
    for (const m of this.audience(sop, members)) {
      if (m.user.id === by.id) continue;
      await this.notifications.create(m.user.id, {
        type: "ops_must_read",
        title: sop.version > 1 ? `Updated must-read: ${sop.title}` : `New must-read: ${sop.title}`,
        body: `${by.name} asks you to read and confirm it`,
        opsSopId: sop.id,
        actorUserId: by.id,
      });
    }
  }
}

function actor(u: Pick<User, "id" | "name">): OpsActor {
  return { id: u.id, name: u.name };
}

/** Every word somewhere in the SOP: title, summary, warnings, steps or details. */
function matches(s: OpsSopRecord, terms: string[]): boolean {
  const hay = [s.title, s.summary, s.warnings, ...s.steps.map((x) => x.text), knowledgeText(s.body)].join("\n").toLowerCase();
  return terms.every((t) => hay.includes(t));
}
