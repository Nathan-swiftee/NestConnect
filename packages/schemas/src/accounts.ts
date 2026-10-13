import { z } from "zod";

/*
 * Organisations — customer companies, and what it takes to serve them.
 *
 * Called "Account" in code because "Organization" already means the workspace
 * (the tenant: Swiftee, Ding, Outwork…). Every account belongs to exactly one
 * workspace, so one business's customers and their instructions are never
 * visible to another's people.
 *
 * Nothing here is specific to deliveries, restaurants or staffing: a workspace
 * names its own SOP categories and resource categories. The knowledge is for
 * people to read and act on — nothing in it is executed.
 */

export const ACCOUNT_STATUSES = ["active", "prospect", "inactive"] as const;
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

/** How loudly an alert speaks. Critical ones lead and are red. */
export const ALERT_PRIORITIES = ["critical", "important", "info"] as const;
export const alertPrioritySchema = z.enum(ALERT_PRIORITIES);
export type AlertPriority = z.infer<typeof alertPrioritySchema>;

/** Only an active SOP is presented as how things are done. */
export const SOP_STATUSES = ["active", "draft", "archived"] as const;
export const sopStatusSchema = z.enum(SOP_STATUSES);
export type SopStatus = z.infer<typeof sopStatusSchema>;

export const RESOURCE_KINDS = ["link", "file", "app"] as const;
export const resourceKindSchema = z.enum(RESOURCE_KINDS);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

/** Starting suggestions for SOP categories; any text is allowed. */
export const SUGGESTED_SOP_CATEGORIES = [
  "Bookings",
  "Recurring work",
  "Collections & deliveries",
  "Exceptions & failures",
  "Billing & invoicing",
  "Communication",
  "General",
] as const;

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), "Must be a web address starting with http:// or https://");

/** Who did something, as it reads in the UI (kept even if they later leave). */
export const actorSchema = z.object({ id: z.string().nullable(), name: z.string() });
export type Actor = z.infer<typeof actorSchema>;

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  reference: z.string().nullable(),
  /** One line: who they are, what we do for them. */
  summary: z.string(),
  /** The longer internal overview. */
  overview: z.string(),
  status: accountStatusSchema,
  tags: z.array(z.string()),
  ownerUserId: z.string().nullable(),
  ownerName: z.string().nullable(),
  /** Where its people's new chats go, unless a contact has routing of their own. */
  routeTeamId: z.string().nullable(),
  routeUserId: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: actorSchema.nullable(),
  updatedBy: actorSchema.nullable(),
});
export type Account = z.infer<typeof accountSchema>;

/** A row in the directory. */
export const accountListItemSchema = accountSchema
  .pick({
    id: true,
    name: true,
    legalName: true,
    reference: true,
    summary: true,
    status: true,
    tags: true,
    ownerUserId: true,
    ownerName: true,
    routeTeamId: true,
    routeUserId: true,
    archivedAt: true,
    updatedAt: true,
  })
  .extend({
    contactCount: z.number().int(),
    alertCount: z.number().int(),
    sopCount: z.number().int(),
  });
export type AccountListItem = z.infer<typeof accountListItemSchema>;

/** A contact's place in an organisation. */
export const accountContactSchema = z.object({
  accountId: z.string(),
  contactId: z.string(),
  role: z.string().nullable(),
  department: z.string().nullable(),
  isPrimary: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  /** The contact as the directory shows it. */
  contact: z.object({
    id: z.string(),
    displayName: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
    avatarColor: z.string().optional(),
    blocked: z.boolean().optional(),
  }),
});
export type AccountContact = z.infer<typeof accountContactSchema>;

export const accountAlertSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  body: z.string(),
  priority: alertPrioritySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: actorSchema.nullable(),
  updatedBy: actorSchema.nullable(),
});
export type AccountAlert = z.infer<typeof accountAlertSchema>;

export const sopStepSchema = z.object({ text: z.string() });
export type SopStep = z.infer<typeof sopStepSchema>;

export const accountSopSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  title: z.string(),
  category: z.string(),
  summary: z.string(),
  /** Read before anything else; shown as a warning. */
  warnings: z.string(),
  /** The procedure, in order. Read as a numbered checklist. */
  steps: z.array(sopStepSchema),
  /** Detailed instructions — sanitized HTML from the editor. */
  body: z.string(),
  status: sopStatusSchema,
  /** Bumped on every saved change; earlier versions are in the history. */
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: actorSchema.nullable(),
  updatedBy: actorSchema.nullable(),
});
export type AccountSop = z.infer<typeof accountSopSchema>;

export const accountSopRevisionSchema = accountSopSchema
  .pick({ title: true, category: true, summary: true, warnings: true, steps: true, body: true, status: true, version: true })
  .extend({ id: z.string(), sopId: z.string(), editedAt: z.string(), editedBy: actorSchema.nullable() });
export type AccountSopRevision = z.infer<typeof accountSopRevisionSchema>;

export const accountNoteSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  title: z.string(),
  /** Sanitized HTML. */
  body: z.string(),
  category: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: actorSchema.nullable(),
  updatedBy: actorSchema.nullable(),
});
export type AccountNote = z.infer<typeof accountNoteSchema>;

export const accountResourceSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  kind: resourceKindSchema,
  title: z.string(),
  description: z.string(),
  category: z.string(),
  /** For links and apps. */
  url: z.string().nullable(),
  /** For an app: how to use it for this customer. */
  instructions: z.string(),
  /** For a file: the stored upload, served at /api/media/:id. */
  attachmentId: z.string().nullable(),
  fileName: z.string().nullable(),
  fileMime: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  /** The SOP this belongs with, if any. */
  sopId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: actorSchema.nullable(),
});
export type AccountResource = z.infer<typeof accountResourceSchema>;

export const accountActivitySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  actor: actorSchema.nullable(),
  /** Machine-readable: "sop.updated", "contact.linked", … */
  action: z.string(),
  /** Human-readable: "Updated SOP “Weekly magazine run” (v3)". */
  summary: z.string(),
  createdAt: z.string(),
});
export type AccountActivity = z.infer<typeof accountActivitySchema>;

/** Everything on an organisation's profile. */
export const accountDetailSchema = z.object({
  account: accountSchema,
  contacts: z.array(accountContactSchema),
  alerts: z.array(accountAlertSchema),
  sops: z.array(accountSopSchema),
  notes: z.array(accountNoteSchema),
  resources: z.array(accountResourceSchema),
  /** Who its routing reaches: its people whose chats it decides, those with
   *  routing of their own (which wins), and those in several organisations
   *  where it isn't clear which one routes. */
  routing: z.object({
    appliesTo: z.number().int(),
    ownRouting: z.number().int(),
    unclear: z.number().int(),
  }),
});
export type AccountDetail = z.infer<typeof accountDetailSchema>;

/** A contact's organisations, for their profile and the inbox. */
export const contactAccountSchema = z.object({
  account: accountListItemSchema,
  link: accountContactSchema.omit({ contact: true }),
});
export type ContactAccount = z.infer<typeof contactAccountSchema>;

/**
 * What the inbox shows beside a conversation.
 *
 * `account` is the organisation the conversation is about, when that's known:
 * chosen for this conversation, or the contact's only organisation. With
 * several and none chosen it is null and `needsChoice` is true — the panel asks
 * rather than guessing, so nobody acts on the wrong customer's instructions.
 */
export const conversationAccountContextSchema = z.object({
  conversationId: z.string(),
  contactId: z.string(),
  linked: z.array(contactAccountSchema),
  /** Chosen for this conversation (may no longer be linked to the contact). */
  selectedAccountId: z.string().nullable(),
  /** "chosen": picked for this conversation; "only": the contact's single organisation. */
  basis: z.enum(["chosen", "only"]).nullable(),
  needsChoice: z.boolean(),
  account: z
    .object({
      account: accountSchema,
      alerts: z.array(accountAlertSchema),
      /** Active SOPs only. */
      sops: z.array(accountSopSchema),
      resources: z.array(accountResourceSchema),
      noteCount: z.number().int(),
      contactCount: z.number().int(),
      /** This contact's role there, if linked. */
      link: accountContactSchema.omit({ contact: true }).nullable(),
    })
    .nullable(),
});
export type ConversationAccountContext = z.infer<typeof conversationAccountContextSchema>;

/* ------------------------------- inputs ------------------------------- */

export const createAccountInputSchema = z.object({
  name: trimmed(160).min(1, "A name is required"),
  legalName: optionalText(200),
  reference: optionalText(80),
  summary: trimmed(280).optional().default(""),
  overview: trimmed(20_000).optional().default(""),
  status: accountStatusSchema.optional().default("active"),
  tags: z.array(trimmed(40).min(1)).max(30).optional().default([]),
  ownerUserId: z.string().nullable().optional(),
  phone: optionalText(60),
  email: optionalText(200),
  website: optionalText(500),
  address: optionalText(1000),
  /** Create even though one with the same name exists. */
  force: z.boolean().optional(),
  /** Link this contact straight away (from the inbox / a contact's profile). */
  contactId: z.string().optional(),
  /** People to add as it's created. */
  contactIds: z.array(z.string().min(1)).max(200).optional(),
});
export type CreateAccountInput = z.input<typeof createAccountInputSchema>;

export const updateAccountInputSchema = createAccountInputSchema
  .omit({ force: true, contactId: true, contactIds: true })
  .partial()
  .extend({ name: trimmed(160).min(1).optional() });
export type UpdateAccountInput = z.input<typeof updateAccountInputSchema>;

export const linkContactInputSchema = z.object({
  contactId: z.string().min(1),
  role: optionalText(120),
  department: optionalText(120),
  isPrimary: z.boolean().optional().default(false),
  notes: optionalText(2000),
});
export type LinkContactInput = z.input<typeof linkContactInputSchema>;
/** Several people added to an organisation in one go. */
export const linkContactsInputSchema = z.object({ contactIds: z.array(z.string().min(1)).min(1).max(200) });
export type LinkContactsInput = z.input<typeof linkContactsInputSchema>;
export const updateContactLinkInputSchema = linkContactInputSchema.omit({ contactId: true }).partial();
export type UpdateContactLinkInput = z.input<typeof updateContactLinkInputSchema>;

export const alertInputSchema = z.object({
  body: trimmed(600).min(1, "Say what people must know"),
  priority: alertPrioritySchema.optional().default("important"),
});
export type AlertInput = z.input<typeof alertInputSchema>;
export const updateAlertInputSchema = alertInputSchema.partial();

export const sopInputSchema = z.object({
  title: trimmed(160).min(1, "A title is required"),
  category: trimmed(80).optional().default("General"),
  summary: trimmed(500).optional().default(""),
  warnings: trimmed(2000).optional().default(""),
  steps: z.array(z.object({ text: trimmed(1000).min(1) })).max(100).optional().default([]),
  body: z.string().max(200_000).optional().default(""),
  status: sopStatusSchema.optional().default("active"),
});
export type SopInput = z.input<typeof sopInputSchema>;
export const updateSopInputSchema = sopInputSchema.partial();
export type UpdateSopInput = z.input<typeof updateSopInputSchema>;

export const noteInputSchema = z.object({
  title: trimmed(160).optional().default(""),
  body: z.string().max(100_000).min(1, "The note is empty"),
  category: trimmed(80).optional().default("General"),
});
export type NoteInput = z.input<typeof noteInputSchema>;
export const updateNoteInputSchema = noteInputSchema.partial();

export const resourceInputSchema = z
  .object({
    kind: resourceKindSchema,
    title: trimmed(160).min(1, "A name is required"),
    description: trimmed(1000).optional().default(""),
    category: trimmed(80).optional().default("General"),
    url: httpUrl.optional().nullable(),
    instructions: trimmed(5000).optional().default(""),
    /** A staged upload from POST /api/media. */
    attachmentId: z.string().optional().nullable(),
    sopId: z.string().optional().nullable(),
  })
  .refine((r) => (r.kind === "file" ? !!r.attachmentId : !!r.url), {
    message: "A file needs an upload; a link or app needs its web address",
  });
export type ResourceInput = z.input<typeof resourceInputSchema>;
export const updateResourceInputSchema = z.object({
  title: trimmed(160).min(1).optional(),
  description: trimmed(1000).optional(),
  category: trimmed(80).optional(),
  url: httpUrl.optional().nullable(),
  instructions: trimmed(5000).optional(),
  sopId: z.string().optional().nullable(),
});
export type UpdateResourceInput = z.input<typeof updateResourceInputSchema>;

export const setConversationAccountInputSchema = z.object({ accountId: z.string().nullable() });

/**
 * The comparable form of a company name, for spotting a duplicate before it's
 * made: case, punctuation and the legal suffix don't make a different company.
 */
export function accountNameKey(name: string): string {
  return name
    .toLowerCase()
    // "A.B.C." is "abc", "O'Neill's" is "oneills".
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(ltd|limited|plc|llp|llc|inc|incorporated|co|company|corp|corporation|gmbh|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---- routing ---- */

/** Set an organisation's routing. Team required to route; person optional. */
export const accountRoutingInputSchema = z.object({
  teamId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
});
export type AccountRoutingInput = z.infer<typeof accountRoutingInputSchema>;

interface RoutableAccount {
  id: string;
  name: string;
  routeTeamId: string | null;
  routeUserId?: string | null;
  archivedAt?: string | null;
}

/**
 * Which of a contact's organisations decides where their new chats go — the
 * same "don't guess" rule the inbox uses for which organisation a chat is
 * about:
 *
 *   - one organisation (not archived): that one;
 *   - several: the one that has routing set, if only one does;
 *   - otherwise none, and `ambiguous` says it was a choice we wouldn't make.
 *
 * `account` is returned only when it actually routes (has a team).
 */
export function routingAccount<T extends RoutableAccount>(accounts: T[]): { account: T | null; ambiguous: boolean } {
  const live = accounts.filter((a) => !a.archivedAt);
  if (live.length === 1) return { account: live[0]!.routeTeamId ? live[0]! : null, ambiguous: false };
  const routed = live.filter((a) => a.routeTeamId);
  if (routed.length === 1) return { account: routed[0]!, ambiguous: false };
  return { account: null, ambiguous: routed.length > 1 };
}
