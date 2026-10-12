import { z } from "zod";

/*
 * Macros — saved replies an agent drops into the composer and edits before
 * sending. Text only: a macro writes, it doesn't act.
 *
 * Each one belongs to team inboxes. A conversation offers the macros of its
 * team (the team it is assigned to; before that, the teams its channel is
 * filed under) plus the ones that belong to every team. Admins and managers
 * write them in Settings › Macros; everybody uses them.
 */

/** "/delayed": letters, digits, - and _, so it can be typed straight after the slash. */
export const MACRO_SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const macroSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Typed after "/" in the composer. Optional — a macro can be picked by name. */
  shortcut: z.string().nullable(),
  /** The reply. May carry the template placeholders, e.g. {{contact.first_name}}. */
  body: z.string(),
  /** Team inboxes it belongs to. Empty means every team. */
  teamIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.object({ id: z.string().nullable(), name: z.string() }).nullable(),
});
export type Macro = z.infer<typeof macroSchema>;

const shortcutInput = z
  .string()
  .trim()
  .transform((s) => s.replace(/^\/+/, "").toLowerCase())
  .refine((s) => s === "" || MACRO_SHORTCUT_PATTERN.test(s), {
    message: "A shortcut is letters, numbers, - or _ (up to 32), e.g. delayed",
  })
  .transform((s) => (s === "" ? null : s));

export const createMacroInputSchema = z.object({
  name: z.string().trim().min(1, "Give the macro a name").max(80),
  shortcut: shortcutInput.nullable().optional(),
  body: z.string().trim().min(1, "The macro has no text").max(4000),
  teamIds: z.array(z.string().min(1)).max(50).optional().default([]),
});
export type CreateMacroInput = z.input<typeof createMacroInputSchema>;

export const updateMacroInputSchema = createMacroInputSchema.partial();
export type UpdateMacroInput = z.input<typeof updateMacroInputSchema>;

/** Whether a macro is offered to a conversation in these team inboxes. */
export function macroFitsTeams(macro: { teamIds: string[] }, teamIds: string[]): boolean {
  return macro.teamIds.length === 0 || macro.teamIds.some((t) => teamIds.includes(t));
}

/** "Macro 2" before "Macro 10", and case doesn't matter. */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * The macros matching what's typed after "/" (or into the picker's search):
 * shortcut matches first, exact before prefix, then names, then the text.
 */
export function searchMacros<T extends { name: string; shortcut: string | null; body: string }>(macros: T[], query: string): T[] {
  const q = query.trim().toLowerCase().replace(/^\/+/, "");
  if (!q) return [...macros].sort((a, b) => byName(a.name, b.name));
  const rank = (m: T): number => {
    const sc = m.shortcut ?? "";
    if (sc === q) return 0;
    if (sc.startsWith(q)) return 1;
    if (m.name.toLowerCase().startsWith(q)) return 2;
    if (sc.includes(q) || m.name.toLowerCase().includes(q)) return 3;
    if (m.body.toLowerCase().includes(q)) return 4;
    return 9;
  };
  return macros
    .map((m) => ({ m, r: rank(m) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || byName(a.m.name, b.m.name))
    .map((x) => x.m);
}

/**
 * What the settings preview fills placeholders with, so an admin sees the shape
 * of a macro before an agent sends it. Same samples as the template menu.
 */
export const MACRO_PREVIEW_FILL = {
  contactName: "Marta Kowalska",
  contactCompany: "Northside Logistics",
  contactPhone: "+44 7700 900123",
  contactEmail: "marta@example.com",
  agentName: "Nathan A",
  channelName: "Swiftee Support",
} as const;

/**
 * The "/word" being typed at the caret, if any: the text after a slash that
 * starts the message or follows a space, up to the caret. `null` when the
 * caret isn't in one — so "http://", "1/2" and "and/or" never open the menu.
 */
export function macroQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)\/([a-z0-9_-]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}
