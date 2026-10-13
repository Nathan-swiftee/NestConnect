import { Injectable } from "@nestjs/common";
import type { OpsActor, OpsRevision } from "@ding/schemas";
import { boundOrgId } from "../tenancy/tenant-scope";
import { OpsStore, type OpsAckRecord, type OpsCollectionRecord, type OpsSopFields, type OpsSopRecord } from "./ops.store";

type Owned<T> = T & { orgId: string };
const clone = <T>(v: T): T => structuredClone(v);

/** In memory, for dev and the checks. Scoped to the bound workspace like the real one. */
@Injectable()
export class MemoryOpsStore extends OpsStore {
  private collections: Owned<OpsCollectionRecord>[] = [];
  private sops: Owned<OpsSopRecord>[] = [];
  private revisions: Array<OpsRevision & { opsSopId: string }> = [];
  private acks: OpsAckRecord[] = [];
  private checklists = new Map<string, number[]>();
  private seq = 0;

  private mine(r: { orgId: string }): boolean {
    const org = boundOrgId();
    return !org || r.orgId === org;
  }
  private org(): string {
    return boundOrgId() ?? "org_swiftee";
  }
  private strip<T extends { orgId: string }>({ orgId: _o, ...rest }: T): Omit<T, "orgId"> {
    return clone(rest);
  }
  private sopIsMine(id: string): boolean {
    return this.sops.some((s) => s.id === id && this.mine(s));
  }

  async listCollections(): Promise<OpsCollectionRecord[]> {
    return this.collections
      .filter((c) => this.mine(c))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((c) => this.strip(c));
  }
  async getCollection(id: string): Promise<OpsCollectionRecord | undefined> {
    const c = this.collections.find((x) => x.id === id && this.mine(x));
    return c ? this.strip(c) : undefined;
  }
  async collectionByName(name: string): Promise<OpsCollectionRecord | undefined> {
    const c = this.collections.find((x) => x.name.toLowerCase() === name.toLowerCase() && this.mine(x));
    return c ? this.strip(c) : undefined;
  }
  async createCollection(f: Omit<OpsCollectionRecord, "id" | "order">): Promise<OpsCollectionRecord> {
    const order = this.collections.filter((c) => this.mine(c)).reduce((m, c) => Math.max(m, c.order), -1) + 1;
    const c = { ...f, id: `opc_${++this.seq}`, order, orgId: this.org() };
    this.collections.push(c);
    return this.strip(c);
  }
  async updateCollection(id: string, patch: Partial<Omit<OpsCollectionRecord, "id">>): Promise<OpsCollectionRecord | undefined> {
    const c = this.collections.find((x) => x.id === id && this.mine(x));
    if (!c) return undefined;
    Object.assign(c, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return this.strip(c);
  }
  async removeCollection(id: string): Promise<boolean> {
    const c = this.collections.find((x) => x.id === id && this.mine(x));
    if (!c) return false;
    this.collections = this.collections.filter((x) => x !== c);
    for (const s of this.sops) if (s.collectionId === id) s.collectionId = null;
    return true;
  }

  async listSops(): Promise<OpsSopRecord[]> {
    return this.sops.filter((s) => this.mine(s)).map((s) => this.strip(s));
  }
  async getSop(id: string): Promise<OpsSopRecord | undefined> {
    const s = this.sops.find((x) => x.id === id && this.mine(x));
    return s ? this.strip(s) : undefined;
  }
  async createSop(f: OpsSopFields, by: OpsActor): Promise<OpsSopRecord> {
    const now = new Date().toISOString();
    const s: Owned<OpsSopRecord> = {
      ...clone(f),
      teamIds: [...new Set(f.teamIds)].sort(),
      id: `ops_${++this.seq}`,
      orgId: this.org(),
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.sops.push(s);
    return this.strip(s);
  }
  async updateSop(id: string, patch: Partial<OpsSopFields>, by?: OpsActor): Promise<OpsSopRecord | undefined> {
    const s = this.sops.find((x) => x.id === id && this.mine(x));
    if (!s) return undefined;
    Object.assign(s, clone(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))));
    if (patch.teamIds) s.teamIds = [...new Set(patch.teamIds)].sort();
    if (by) {
      s.updatedAt = new Date().toISOString();
      s.updatedBy = by;
    }
    return this.strip(s);
  }
  async removeSop(id: string): Promise<boolean> {
    if (!this.sopIsMine(id)) return false;
    this.sops = this.sops.filter((x) => x.id !== id);
    this.revisions = this.revisions.filter((r) => r.opsSopId !== id);
    this.acks = this.acks.filter((a) => a.opsSopId !== id);
    for (const k of [...this.checklists.keys()]) if (k.startsWith(`${id}:`)) this.checklists.delete(k);
    return true;
  }

  async addRevision(opsSopId: string, rev: OpsRevision): Promise<void> {
    if (!this.sopIsMine(opsSopId)) return;
    this.revisions.push({ ...clone(rev), opsSopId });
  }
  async listRevisions(opsSopId: string): Promise<OpsRevision[]> {
    if (!this.sopIsMine(opsSopId)) return [];
    return this.revisions
      .filter((r) => r.opsSopId === opsSopId)
      .sort((a, b) => b.version - a.version)
      .map(({ opsSopId: _id, ...r }) => clone(r));
  }

  async setAck(opsSopId: string, userId: string, version: number): Promise<OpsAckRecord> {
    const at = new Date().toISOString();
    const existing = this.acks.find((a) => a.opsSopId === opsSopId && a.userId === userId);
    if (existing) Object.assign(existing, { version, at });
    else this.acks.push({ opsSopId, userId, version, at });
    return { opsSopId, userId, version, at };
  }
  async acksForSop(opsSopId: string): Promise<OpsAckRecord[]> {
    if (!this.sopIsMine(opsSopId)) return [];
    return this.acks.filter((a) => a.opsSopId === opsSopId).map(clone);
  }
  async acksForUser(userId: string): Promise<OpsAckRecord[]> {
    return this.acks.filter((a) => a.userId === userId && this.sopIsMine(a.opsSopId)).map(clone);
  }

  async getChecklist(opsSopId: string, userId: string): Promise<number[]> {
    return [...(this.checklists.get(`${opsSopId}:${userId}`) ?? [])];
  }
  async setChecklist(opsSopId: string, userId: string, done: number[]): Promise<number[]> {
    const clean = [...new Set(done)].sort((a, b) => a - b);
    this.checklists.set(`${opsSopId}:${userId}`, clean);
    return [...clean];
  }

  async reviewsDueAcrossWorkspaces(now: Date): Promise<Array<{ id: string; orgId: string }>> {
    return this.sops
      .filter((s) => s.status === "published" && s.reviewDueAt && !s.reviewNotifiedAt && new Date(s.reviewDueAt) <= now)
      .map((s) => ({ id: s.id, orgId: s.orgId }));
  }
}
