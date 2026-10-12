import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { macroFitsTeams, type CreateMacroInput, type Macro, type UpdateMacroInput, type User } from "@ding/schemas";
import { Store } from "../data/store";
import { MacroStore, type MacroFields } from "./macro.store";

/**
 * Macros: who may change them, which a conversation is offered, and the rules
 * a save has to pass. See docs/macros.md.
 */
@Injectable()
export class MacrosService {
  constructor(
    private readonly macros: MacroStore,
    private readonly store: Store,
  ) {}

  /** Every macro in the workspace — Settings › Macros. */
  list(): Promise<Macro[]> {
    return this.macros.list();
  }

  /**
   * The macros this conversation's composer offers: its team inbox's, plus the
   * ones for every team. The team is the one it's assigned to; before that, the
   * teams its channel is filed under.
   */
  async forConversation(conversationId: string): Promise<Macro[]> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv) throw new NotFoundException("Conversation not found");
    const teamIds = conv.assignedTeamId
      ? [conv.assignedTeamId]
      : ((await this.store.getInbox(conv.inboxId))?.teamIds ?? []);
    return (await this.macros.list()).filter((m) => macroFitsTeams(m, teamIds));
  }

  async create(userId: string, input: CreateMacroInput): Promise<Macro> {
    const user = await this.manager(userId);
    // Validated by the pipe: trimmed, the shortcut normalised, teamIds defaulted.
    const fields: MacroFields = {
      name: input.name,
      shortcut: input.shortcut ?? null,
      body: input.body,
      teamIds: [...new Set(input.teamIds ?? [])],
    };
    await this.check(fields);
    return this.macros.create(fields, { id: user.id, name: user.name });
  }

  async update(userId: string, id: string, input: UpdateMacroInput): Promise<Macro> {
    const user = await this.manager(userId);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<MacroFields>;
    if (patch.teamIds) patch.teamIds = [...new Set(patch.teamIds)];
    if (!(await this.macros.get(id))) throw new NotFoundException("Macro not found");
    await this.check(patch, id);
    const saved = await this.macros.update(id, patch, { id: user.id, name: user.name });
    if (!saved) throw new NotFoundException("Macro not found");
    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.manager(userId);
    if (!(await this.macros.remove(id))) throw new NotFoundException("Macro not found");
  }

  /** Writing macros is for admins and managers; everybody uses them. */
  private async manager(userId: string): Promise<User> {
    const user = await this.store.getUser(userId);
    if (!user) throw new ForbiddenException("Not signed in");
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("Only a manager or admin can change macros");
    }
    return user;
  }

  private async check(f: Partial<MacroFields>, id?: string): Promise<void> {
    if (f.teamIds?.length) {
      // Teams of this workspace only. The Postgres store would refuse another
      // workspace's id anyway; this says which, in words.
      const known = new Set((await this.store.listTeams()).map((t) => t.id));
      if (f.teamIds.some((t) => !known.has(t))) throw new BadRequestException("One of those teams doesn't exist");
    }
    if (f.shortcut) {
      const taken = await this.macros.byShortcut(f.shortcut);
      if (taken && taken.id !== id) {
        throw new ConflictException(`/${f.shortcut} is already the shortcut for “${taken.name}”`);
      }
    }
  }
}
