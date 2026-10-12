import type { Macro } from "@ding/schemas";

export interface MacroFields {
  name: string;
  shortcut: string | null;
  body: string;
  teamIds: string[];
}

export interface MacroActor {
  id: string | null;
  name: string;
}

/**
 * Where macros live. Its own small store, beside the core one rather than in
 * it, as organisations are: two implementations (Postgres, scoped to the bound
 * workspace; and in memory, for dev and the checks).
 */
export abstract class MacroStore {
  abstract list(): Promise<Macro[]>;
  abstract get(id: string): Promise<Macro | undefined>;
  /** The macro already holding this shortcut in the workspace, if any. */
  abstract byShortcut(shortcut: string): Promise<Macro | undefined>;
  abstract create(fields: MacroFields, by: MacroActor): Promise<Macro>;
  abstract update(id: string, patch: Partial<MacroFields>, by: MacroActor): Promise<Macro | undefined>;
  abstract remove(id: string): Promise<boolean>;
}
