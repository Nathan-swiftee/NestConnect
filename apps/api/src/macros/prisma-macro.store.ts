import { Injectable } from "@nestjs/common";
import type { Macro } from "@ding/schemas";
import { PrismaService } from "../data/prisma.service";
import { tenantScoped, type TenantPrisma } from "../data/tenant-prisma";
import { currentOrgId } from "../tenancy/tenant-scope";
import { MacroStore, type MacroActor, type MacroFields } from "./macro.store";

const withTeams = { teams: { select: { teamId: true } } } as const;

type Row = {
  id: string;
  name: string;
  shortcut: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
  teams: Array<{ teamId: string }>;
};

function toMacro(r: Row): Macro {
  return {
    id: r.id,
    name: r.name,
    shortcut: r.shortcut,
    body: r.body,
    teamIds: r.teams.map((t) => t.teamId).sort(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedByName ? { id: r.updatedById, name: r.updatedByName } : null,
  };
}

/** Postgres, through the tenant-scoped client: every query is the bound workspace's,
 *  and a team id from another workspace is refused on write. */
@Injectable()
export class PrismaMacroStore extends MacroStore {
  private readonly prisma: TenantPrisma;

  constructor(root: PrismaService) {
    super();
    this.prisma = tenantScoped(root);
  }

  async list(): Promise<Macro[]> {
    const rows = await this.prisma.macro.findMany({ include: withTeams, orderBy: { name: "asc" } });
    return rows.map(toMacro);
  }

  async get(id: string): Promise<Macro | undefined> {
    const r = await this.prisma.macro.findUnique({ where: { id }, include: withTeams });
    return r ? toMacro(r) : undefined;
  }

  async byShortcut(shortcut: string): Promise<Macro | undefined> {
    const r = await this.prisma.macro.findFirst({ where: { shortcut }, include: withTeams });
    return r ? toMacro(r) : undefined;
  }

  async create(f: MacroFields, by: MacroActor): Promise<Macro> {
    const r = await this.prisma.macro.create({
      data: {
        orgId: currentOrgId(),
        name: f.name,
        shortcut: f.shortcut,
        body: f.body,
        createdById: by.id,
        createdByName: by.name,
        updatedById: by.id,
        updatedByName: by.name,
        teams: { create: f.teamIds.map((teamId) => ({ teamId })) },
      },
      include: withTeams,
    });
    return toMacro(r);
  }

  async update(id: string, patch: Partial<MacroFields>, by: MacroActor): Promise<Macro | undefined> {
    const found = await this.prisma.macro.findUnique({ where: { id }, select: { id: true } });
    if (!found) return undefined;
    if (patch.teamIds) {
      // Replaced wholesale: the form sends the full set.
      await this.prisma.macroTeam.deleteMany({ where: { macroId: id } });
      for (const teamId of [...new Set(patch.teamIds)]) await this.prisma.macroTeam.create({ data: { macroId: id, teamId } });
    }
    const r = await this.prisma.macro.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.shortcut !== undefined ? { shortcut: patch.shortcut } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        updatedById: by.id,
        updatedByName: by.name,
      },
      include: withTeams,
    });
    return toMacro(r);
  }

  async remove(id: string): Promise<boolean> {
    const found = await this.prisma.macro.findUnique({ where: { id }, select: { id: true } });
    if (!found) return false;
    await this.prisma.macro.delete({ where: { id } });
    return true;
  }
}
