import type { OpsActor, OpsResource, OpsRevision, OpsStatus, OpsStep } from "@ding/schemas";

/** An SOP as stored. The service turns it into what each person sees. */
export interface OpsSopRecord {
  id: string;
  collectionId: string | null;
  title: string;
  icon: string;
  color: string;
  summary: string;
  warnings: string;
  steps: OpsStep[];
  body: string;
  resources: OpsResource[];
  teamIds: string[];
  allTeams: boolean;
  status: OpsStatus;
  version: number;
  mustRead: boolean;
  reviewEveryMonths: number | null;
  reviewDueAt: string | null;
  reviewNotifiedAt: string | null;
  lastReviewedAt: string | null;
  owner: OpsActor | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: OpsActor | null;
}

export type OpsSopFields = Omit<OpsSopRecord, "id" | "createdAt" | "updatedAt" | "updatedBy">;

export interface OpsCollectionRecord {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
}

export interface OpsAckRecord {
  opsSopId: string;
  userId: string;
  version: number;
  at: string;
}

/**
 * Where Business Ops lives. Its own store beside the core one, as macros and
 * organisations are: Postgres scoped to the bound workspace, and in memory for
 * dev and the checks. See docs/business-ops.md.
 */
export abstract class OpsStore {
  abstract listCollections(): Promise<OpsCollectionRecord[]>;
  abstract getCollection(id: string): Promise<OpsCollectionRecord | undefined>;
  abstract collectionByName(name: string): Promise<OpsCollectionRecord | undefined>;
  abstract createCollection(f: Omit<OpsCollectionRecord, "id" | "order">): Promise<OpsCollectionRecord>;
  abstract updateCollection(id: string, patch: Partial<Omit<OpsCollectionRecord, "id">>): Promise<OpsCollectionRecord | undefined>;
  /** Its SOPs stay, outside any collection. */
  abstract removeCollection(id: string): Promise<boolean>;

  abstract listSops(): Promise<OpsSopRecord[]>;
  abstract getSop(id: string): Promise<OpsSopRecord | undefined>;
  abstract createSop(f: OpsSopFields, by: OpsActor): Promise<OpsSopRecord>;
  /** `by` is who edited it; left out, the change isn't anybody's edit (a reminder sent). */
  abstract updateSop(id: string, patch: Partial<OpsSopFields>, by?: OpsActor): Promise<OpsSopRecord | undefined>;
  abstract removeSop(id: string): Promise<boolean>;

  abstract addRevision(opsSopId: string, rev: OpsRevision): Promise<void>;
  /** Newest first. */
  abstract listRevisions(opsSopId: string): Promise<OpsRevision[]>;

  abstract setAck(opsSopId: string, userId: string, version: number): Promise<OpsAckRecord>;
  abstract acksForSop(opsSopId: string): Promise<OpsAckRecord[]>;
  abstract acksForUser(userId: string): Promise<OpsAckRecord[]>;

  abstract getChecklist(opsSopId: string, userId: string): Promise<number[]>;
  abstract setChecklist(opsSopId: string, userId: string, done: number[]): Promise<number[]>;

  /** Published SOPs past their review date whose owner hasn't been told yet, in
   *  every workspace. Cross-tenant: each is then handled inside its own. */
  abstract reviewsDueAcrossWorkspaces(now: Date): Promise<Array<{ id: string; orgId: string }>>;
}
