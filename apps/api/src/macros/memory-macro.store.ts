import { Injectable } from "@nestjs/common";
import type { Macro } from "@ding/schemas";
import { boundOrgId } from "../tenancy/tenant-scope";
import { MacroStore, type MacroActor, type MacroFields } from "./macro.store";

type Row = Macro & { orgId: string };

/** In memory, for dev and the checks. Scoped to the bound workspace like the real one. */
@Injectable()
export class MemoryMacroStore extends MacroStore {
  private rows: Row[] = [];
  private seq = 0;

  private mine(r: Row): boolean {
    const org = boundOrgId();
    return !org || r.orgId === org;
  }
  private out({ orgId: _orgId, ...m }: Row): Macro {
    return { ...m, teamIds: [...m.teamIds] };
  }

  async list(): Promise<Macro[]> {
    return this.rows.filter((r) => this.mine(r)).sort((a, b) => a.name.localeCompare(b.name)).map((r) => this.out(r));
  }

  async get(id: string): Promise<Macro | undefined> {
    const r = this.rows.find((x) => x.id === id && this.mine(x));
    return r ? this.out(r) : undefined;
  }

  async byShortcut(shortcut: string): Promise<Macro | undefined> {
    const r = this.rows.find((x) => x.shortcut === shortcut && this.mine(x));
    return r ? this.out(r) : undefined;
  }

  async create(f: MacroFields, by: MacroActor): Promise<Macro> {
    const now = new Date().toISOString();
    const r: Row = {
      id: `mac_${++this.seq}`,
      orgId: boundOrgId() ?? "org_swiftee",
      name: f.name,
      shortcut: f.shortcut,
      body: f.body,
      teamIds: [...new Set(f.teamIds)].sort(),
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.rows.push(r);
    return this.out(r);
  }

  async update(id: string, patch: Partial<MacroFields>, by: MacroActor): Promise<Macro | undefined> {
    const r = this.rows.find((x) => x.id === id && this.mine(x));
    if (!r) return undefined;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.shortcut !== undefined) r.shortcut = patch.shortcut;
    if (patch.body !== undefined) r.body = patch.body;
    if (patch.teamIds) r.teamIds = [...new Set(patch.teamIds)].sort();
    r.updatedAt = new Date().toISOString();
    r.updatedBy = by;
    return this.out(r);
  }

  async remove(id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((x) => !(x.id === id && this.mine(x)));
    return this.rows.length < before;
  }
}
