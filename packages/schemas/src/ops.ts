import { z } from "zod";

/*
 * Business Ops — the workspace's own standard operating procedures.
 *
 * Not about any customer (that's Organisations): how *we* do things — opening
 * the warehouse, a refund, an incident. Each SOP belongs to one or more teams
 * (or all of them); people in those teams read it, admins and managers write
 * it. The whole module can be switched off per workspace without losing
 * anything.
 *
 * An SOP is edited in place. Publishing makes it visible to its teams and keeps
 * a numbered version; a "must read" SOP asks its readers to confirm each new
 * version. A review period puts a due date on it and reminds its owner.
 */

export const OPS_STATUSES = ["draft", "published", "archived"] as const;
export const opsStatusSchema = z.enum(OPS_STATUSES);
export type OpsStatus = z.infer<typeof opsStatusSchema>;

/** The palette SOPs and collections are coloured from. */
export const OPS_COLORS = ["#0FA47A", "#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#CA8A04", "#0891B2", "#475569"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour");
/** An emoji (or short glyph) shown on the card. */
const icon = z.string().trim().min(1).max(16);
const trimmed = (max: number) => z.string().trim().max(max);
/** Pictures are hosted uploads (/api/media/…) or https links. */
const imageRef = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^(\/api\/media\/[\w-]+|https:\/\/\S+)$/.test(v), "Use an uploaded picture or an https link");
const webLink = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\/\S+$/i.test(v), "Must be a web address starting with http:// or https://");

const actorSchema = z.object({ id: z.string().nullable(), name: z.string() });
export type OpsActor = z.infer<typeof actorSchema>;

export const opsStepSchema = z.object({
  text: z.string(),
  imageUrl: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
});
export type OpsStep = z.infer<typeof opsStepSchema>;

export const opsResourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["link", "file"]),
  title: z.string(),
  url: z.string(),
});
export type OpsResource = z.infer<typeof opsResourceSchema>;

export const opsCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  order: z.number().int(),
  /** SOPs in it the asker can see. */
  sopCount: z.number().int(),
});
export type OpsCollection = z.infer<typeof opsCollectionSchema>;

/** What a library card needs. */
export const opsSopCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string(),
  color: z.string(),
  summary: z.string(),
  collectionId: z.string().nullable(),
  teamIds: z.array(z.string()),
  allTeams: z.boolean(),
  status: opsStatusSchema,
  /** The published version; 0 while it has never been published. */
  version: z.number().int(),
  stepCount: z.number().int(),
  mustRead: z.boolean(),
  /** A must-read whose current version I haven't confirmed. */
  needsMyAck: z.boolean(),
  reviewDueAt: z.string().nullable(),
  reviewOverdue: z.boolean(),
  owner: actorSchema.nullable(),
  updatedAt: z.string(),
  updatedBy: actorSchema.nullable(),
  publishedAt: z.string().nullable(),
});
export type OpsSopCard = z.infer<typeof opsSopCardSchema>;

export const opsSopSchema = opsSopCardSchema.extend({
  warnings: z.string(),
  steps: z.array(opsStepSchema),
  /** Details: sanitized HTML from the editor. */
  body: z.string(),
  resources: z.array(opsResourceSchema),
  reviewEveryMonths: z.number().int().nullable(),
  lastReviewedAt: z.string().nullable(),
  /** The version I confirmed, if any. */
  myAck: z.object({ version: z.number().int(), at: z.string() }).nullable(),
  /** Steps I've ticked (indexes), on my checklist. */
  myChecklist: z.array(z.number().int()),
});
export type OpsSop = z.infer<typeof opsSopSchema>;

export const opsRevisionSchema = z.object({
  version: z.number().int(),
  title: z.string(),
  summary: z.string(),
  warnings: z.string(),
  steps: z.array(opsStepSchema),
  body: z.string(),
  note: z.string(),
  publishedAt: z.string(),
  publishedBy: actorSchema.nullable(),
});
export type OpsRevision = z.infer<typeof opsRevisionSchema>;

/** Who has read a must-read, for its editors. */
export const opsAckReportSchema = z.object({
  version: z.number().int(),
  people: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      avatarColor: z.string().nullable().optional(),
      avatarUrl: z.string().nullable().optional(),
      ackedVersion: z.number().int().nullable(),
      ackedAt: z.string().nullable(),
    }),
  ),
});
export type OpsAckReport = z.infer<typeof opsAckReportSchema>;

export const opsStatusInfoSchema = z.object({
  enabled: z.boolean(),
  /** Admins and managers write SOPs; everyone else reads. */
  canEdit: z.boolean(),
  /** Must-reads waiting for me — the rail badge. */
  pendingAcks: z.number().int(),
});
export type OpsStatusInfo = z.infer<typeof opsStatusInfoSchema>;

/** The library: the collections and every SOP the asker can see. */
export const opsLibrarySchema = z.object({
  collections: z.array(opsCollectionSchema),
  sops: z.array(opsSopCardSchema),
});
export type OpsLibrary = z.infer<typeof opsLibrarySchema>;

/* ---- inputs ---- */

export const opsStepInputSchema = z.object({
  text: trimmed(2000).min(1, "A step needs some words"),
  imageUrl: imageRef.nullable().optional(),
  link: webLink.nullable().optional(),
});

export const opsResourceInputSchema = z.object({
  kind: z.enum(["link", "file"]),
  title: trimmed(160).min(1, "Give it a name"),
  /** A web link, or an uploaded file's /api/media/… address. */
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => /^(\/api\/media\/[\w-]+|https?:\/\/\S+)$/i.test(v), "Use an uploaded file or a web link"),
});

export const opsSopInputSchema = z.object({
  title: trimmed(160).min(1, "Give the SOP a title"),
  icon: icon.optional().default("📘"),
  color: hex.optional().default("#0FA47A"),
  collectionId: z.string().nullable().optional().default(null),
  summary: trimmed(500).optional().default(""),
  warnings: trimmed(4000).optional().default(""),
  steps: z.array(opsStepInputSchema).max(100).optional().default([]),
  body: z.string().max(200_000).optional().default(""),
  resources: z.array(opsResourceInputSchema).max(50).optional().default([]),
  /** Teams that can read it. Ignored when allTeams. */
  teamIds: z.array(z.string().min(1)).max(50).optional().default([]),
  allTeams: z.boolean().optional().default(false),
  mustRead: z.boolean().optional().default(false),
  /** Months between reviews; null for none. */
  reviewEveryMonths: z.number().int().min(1).max(36).nullable().optional().default(null),
  ownerUserId: z.string().nullable().optional(),
});
export type OpsSopInput = z.input<typeof opsSopInputSchema>;
export const updateOpsSopInputSchema = opsSopInputSchema.partial();
export type UpdateOpsSopInput = z.input<typeof updateOpsSopInputSchema>;

export const publishOpsSopInputSchema = z.object({ note: trimmed(300).optional().default("") });
export type PublishOpsSopInput = z.input<typeof publishOpsSopInputSchema>;

export const opsCollectionInputSchema = z.object({
  name: trimmed(60).min(1, "Name the collection"),
  icon: icon.optional().default("📁"),
  color: hex.optional().default("#0FA47A"),
});
export type OpsCollectionInput = z.input<typeof opsCollectionInputSchema>;
export const updateOpsCollectionInputSchema = opsCollectionInputSchema.partial().extend({
  order: z.number().int().min(0).max(10_000).optional(),
});
export type UpdateOpsCollectionInput = z.input<typeof updateOpsCollectionInputSchema>;

export const opsChecklistInputSchema = z.object({ done: z.array(z.number().int().min(0).max(99)).max(100) });
export const opsModuleInputSchema = z.object({ enabled: z.boolean() });

/* ---- helpers shared by the editor and the app ---- */

/**
 * Pasted text as steps: one per line, with bullets and numbering ("1.", "2)",
 * "-", "•", "Step 3:") taken off. Blank lines are dropped.
 */
export function splitIntoSteps(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/^(step\s*\d+\s*[:.)-]?|\d+\s*[.)]|[-*•–]|\[\s?[xX ]?\s?\])\s*/i, "")
        .trim(),
    )
    .filter(Boolean);
}

/** Starting points for a new SOP. */
export const OPS_TEMPLATES: Array<{
  key: string;
  name: string;
  description: string;
  icon: string;
  summary: string;
  warnings: string;
  steps: string[];
}> = [
  { key: "blank", name: "Blank", description: "Start from nothing", icon: "📘", summary: "", warnings: "", steps: [] },
  {
    key: "checklist",
    name: "Checklist",
    description: "Things to tick off, in order",
    icon: "✅",
    summary: "The checklist to follow every time.",
    warnings: "",
    steps: ["First thing to check", "Second thing to check", "Confirm everything is done"],
  },
  {
    key: "howto",
    name: "How-to",
    description: "Step-by-step instructions",
    icon: "🛠️",
    summary: "How to do this, start to finish.",
    warnings: "What to have ready before you start.",
    steps: ["Get ready", "Do the main task", "Check the result", "Tell whoever needs to know"],
  },
  {
    key: "incident",
    name: "Incident response",
    description: "What to do when something goes wrong",
    icon: "🚨",
    summary: "What to do the moment this happens.",
    warnings: "Safety first. If anyone is at risk, call emergency services before anything else.",
    steps: [
      "Make it safe and stop it getting worse",
      "Tell your manager",
      "Write down what happened, when and who was involved",
      "Let affected customers know",
      "Log the incident and follow-ups",
    ],
  },
];

/** When an SOP is next due for review: its last publish or review plus the period. */
export function nextReviewDue(from: Date | string, months: number | null): string | null {
  if (!months) return null;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

type OpsContent = Pick<OpsRevision, "title" | "summary" | "warnings" | "steps" | "body">;

/**
 * What a publish changed, in words, for version history: "Title changed",
 * "2 steps added", "Details edited". Empty when nothing visible changed.
 */
export function describeOpsChanges(before: OpsContent | null, after: OpsContent): string[] {
  if (!before) return ["First published"];
  const out: string[] = [];
  if (before.title !== after.title) out.push("Title changed");
  if (before.summary !== after.summary) out.push("Summary edited");
  if (before.warnings !== after.warnings) out.push(after.warnings ? (before.warnings ? "Warnings edited" : "Warnings added") : "Warnings removed");
  const was = before.steps.map((s) => s.text);
  const now = after.steps.map((s) => s.text);
  const added = now.filter((t) => !was.includes(t)).length;
  const removed = was.filter((t) => !now.includes(t)).length;
  const plural = (n: number, w: string) => `${n} step${n === 1 ? "" : "s"} ${w}`;
  if (added && removed && added === removed) out.push(plural(added, "reworded"));
  else {
    if (added) out.push(plural(added, "added"));
    if (removed) out.push(plural(removed, "removed"));
  }
  if (!added && !removed && was.join("\n") !== now.join("\n")) out.push("Steps reordered");
  // The same words with a different picture or link.
  const extras = (s: OpsStep) => `${s.imageUrl ?? ""}|${s.link ?? ""}`;
  const prior = new Map(before.steps.map((s) => [s.text, extras(s)]));
  if (after.steps.some((s) => prior.has(s.text) && prior.get(s.text) !== extras(s))) out.push("Step pictures or links changed");
  if (before.body !== after.body) out.push("Details edited");
  return out;
}

/** Emoji offered for an SOP or collection. Anything else can be typed. */
export const OPS_ICONS = [
  "📘", "📗", "📕", "📙", "📋", "✅", "🛠️", "🚨", "🔥", "🧯", "⚠️", "🛡️",
  "🏭", "📦", "🚚", "🧾", "💳", "💷", "🛒", "🏬", "🍽️", "☕", "🧹", "♻️",
  "🔐", "🔑", "🖥️", "📞", "✉️", "💬", "👥", "🧑‍💼", "🗓️", "⏰", "📈", "🎓",
] as const;

/** The library's quick filters. Drafts, reviews and archived are for editors. */
export const OPS_FILTERS = ["all", "must_read", "review", "drafts", "archived"] as const;
export type OpsFilter = (typeof OPS_FILTERS)[number];

/**
 * Whether a card belongs under a filter. "All" is what's live: published (and,
 * for an editor, drafts too) — archived only shows when asked for.
 */
export function opsCardMatches(card: OpsSopCard, filter: OpsFilter, collectionId?: string | null): boolean {
  if (collectionId && card.collectionId !== collectionId) return false;
  switch (filter) {
    case "all":
      return card.status !== "archived";
    case "must_read":
      return card.mustRead && card.status === "published";
    case "review":
      return card.reviewOverdue;
    case "drafts":
      return card.status === "draft";
    case "archived":
      return card.status === "archived";
  }
}

/** Must-reads waiting for me first, then by title. */
export function sortOpsCards<T extends OpsSopCard>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      Number(b.needsMyAck) - Number(a.needsMyAck) ||
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** "Step 3 of 7" progress for a checklist. */
export function opsProgress(stepCount: number, done: number[]): { done: number; total: number; pct: number } {
  const n = new Set(done.filter((i) => i >= 0 && i < stepCount)).size;
  return { done: n, total: stepCount, pct: stepCount ? Math.round((n / stepCount) * 100) : 0 };
}
