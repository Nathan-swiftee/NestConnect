import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CreateTemplateInput,
  Template,
  TemplateApproval,
  TemplateCategory,
  UpdateTemplateInput,
} from "@ding/schemas";
import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import { Store } from "../data/store";

/*
 * The org setting holding a WhatsApp account's default template id. Empty
 * string = none.
 *
 * One per WABA rather than one per workspace, because this is the template the
 * composer sends *by itself* when a 24-hour window has closed. A single
 * workspace-wide default is guaranteed to be wrong for every account but one,
 * and it would be chosen automatically, silently, at the moment an agent is
 * trying to get back to a customer — the worst possible time to discover that
 * the other account has never heard of it.
 *
 * The bare key is the pre-accounts setting. It is still read as the default for
 * an account that has not chosen one, so a workspace that had a default before
 * this change keeps it instead of quietly losing the fallback.
 */
const DEFAULT_TEMPLATE_KEY = "wa_default_template_id";
const defaultTemplateKey = (wabaId?: string) =>
  wabaId ? `${DEFAULT_TEMPLATE_KEY}:${wabaId}` : DEFAULT_TEMPLATE_KEY;

/*
 * A single number's default, which beats its account's.
 *
 * Two numbers under one WABA are the common arrangement and usually two
 * different things to be — sales and support share every template and should
 * not share the sentence that re-opens a conversation. With the choice keyed to
 * the account, setting one number's default silently changed the other's, and a
 * setting that moves on its own is one that does not work.
 *
 * The account key stays as the fallback rather than being migrated away: it is
 * the right answer for a workspace with one number per account, and for a new
 * number nobody has got round to configuring.
 */
const channelTemplateKey = (inboxId: string) => `${DEFAULT_TEMPLATE_KEY}:inbox:${inboxId}`;

/** WhatsApp channel types — the only ones a template can be sent from. */
const WA_TYPES = new Set(["whatsapp", "whatsapp_group"]);

/** The subset of Meta's message-template payload we read when syncing. */
interface MetaTemplate {
  name: string;
  language: string;
  status?: string;
  category?: string;
  components?: Array<{ type?: string; text?: string }>;
}

/**
 * Message-template management. Templates are stored locally (org-scoped) and can
 * optionally be synced from Meta's `/{waba-id}/message_templates` when a WhatsApp
 * number is connected — otherwise the locally-authored/seeded ones are used.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private readonly store: Store) {}

  /**
   * Every template, flagged as its account's default and listing the numbers it
   * is the closed-window default for.
   *
   * The default lives in org settings rather than a column, so that exactly one
   * template per number can hold it — a column would let two rows both claim it
   * and leave the winner to whichever query ran first.
   */
  async list(): Promise<Template[]> {
    const templates = await this.store.listTemplates(ORG_ID);
    // One lookup per distinct account, not one per template.
    const wabaIds = [...new Set(templates.map((t) => t.wabaId).filter(Boolean))] as string[];
    const legacy = (await this.store.getAppSetting(ORG_ID, DEFAULT_TEMPLATE_KEY)) ?? "";
    const accountDefaults = new Map<string, string>();
    await Promise.all(
      wabaIds.map(async (wabaId) => {
        const own = await this.store.getAppSetting(ORG_ID, defaultTemplateKey(wabaId));
        // Fall back to the pre-accounts setting so a workspace that had a
        // default before templates were scoped does not silently lose it.
        const id = own || legacy;
        if (id) accountDefaults.set(wabaId, id);
      }),
    );

    // Which template each WhatsApp number actually falls back to. Resolved here
    // rather than in the composer because the answer depends on three settings
    // the client has no business reading, and the client must not be the place
    // that decides which sentence goes to a customer.
    const byInbox = await this.resolveByInbox(accountDefaults, legacy);
    const inboxesFor = new Map<string, string[]>();
    for (const [inboxId, templateId] of byInbox) {
      const list = inboxesFor.get(templateId);
      if (list) list.push(inboxId);
      else inboxesFor.set(templateId, [inboxId]);
    }

    return templates.map((t) => ({
      ...t,
      // An unclaimed template still answers to the old workspace-wide setting:
      // it belongs to no account, so there is no per-account key to consult.
      isDefault: t.wabaId
        ? accountDefaults.get(t.wabaId) === t.id
        : Boolean(legacy) && legacy === t.id,
      defaultForInboxIds: inboxesFor.get(t.id) ?? [],
    }));
  }

  /**
   * Every WhatsApp number's effective default, in precedence order: the
   * number's own setting, then its account's, then the pre-accounts workspace
   * one.
   *
   * A number's key is honoured when the row *exists*, not when it is non-empty:
   * an admin who clears a number's template means none, and falling back to the
   * account's would put a sentence they just removed back in front of a
   * customer.
   */
  private async resolveByInbox(
    accountDefaults: Map<string, string>,
    legacy: string,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const inboxes = (await this.store.listInboxes()).filter((i) => WA_TYPES.has(i.type));
    await Promise.all(
      inboxes.map(async (inbox) => {
        const own = await this.store.getAppSetting(ORG_ID, channelTemplateKey(inbox.id));
        if (own !== undefined) {
          if (own) out.set(inbox.id, own);
          return;
        }
        const wabaId = (await this.store.getInboxConfig(inbox.id))?.wabaId;
        const inherited = (wabaId ? accountDefaults.get(wabaId) : undefined) ?? legacy;
        if (inherited) out.set(inbox.id, inherited);
      }),
    );
    return out;
  }

  /**
   * Point one number at a template, or clear its choice with null.
   *
   * Clearing writes an empty row rather than deleting the key, so "none" is a
   * decision the number remembers instead of a gap the account's default
   * immediately fills back in.
   */
  async setChannelDefault(inboxId: string, templateId: string | null): Promise<Template[]> {
    const inbox = (await this.store.listInboxes()).find((i) => i.id === inboxId);
    if (!inbox) throw new NotFoundException("Channel not found");
    if (!WA_TYPES.has(inbox.type)) {
      throw new BadRequestException("Only WhatsApp numbers send templates");
    }
    if (templateId) {
      const template = (await this.store.listTemplates(ORG_ID)).find((t) => t.id === templateId);
      if (!template) throw new NotFoundException("Template not found");
      // A template belonging to another account would be rejected by Meta at
      // the moment it was sent — and sent automatically, so nobody would be
      // looking. Refuse it here, where somebody is.
      const wabaId = (await this.store.getInboxConfig(inboxId))?.wabaId;
      if (template.wabaId && wabaId && template.wabaId !== wabaId) {
        throw new BadRequestException("That template belongs to another WhatsApp account");
      }
      if (template.variableCount !== 1) {
        throw new BadRequestException("A default template needs exactly one {{1}} variable");
      }
    }
    await this.store.setAppSetting(ORG_ID, channelTemplateKey(inboxId), templateId ?? "");
    return this.list();
  }

  /**
   * Make a template its account's default, or clear that account's default with
   * null.
   *
   * Scoped by the template's own account, so setting one number's default never
   * disturbs another's — the two are independent settings that happen to be
   * edited from the same list.
   */
  async setDefault(templateId: string | null): Promise<Template[]> {
    if (!templateId) {
      // Nothing names which account to clear, so clear them all — that is what
      // "no default" means from a screen showing every account's templates.
      const templates = await this.store.listTemplates(ORG_ID);
      const keys = new Set(templates.map((t) => defaultTemplateKey(t.wabaId)));
      keys.add(DEFAULT_TEMPLATE_KEY);
      await Promise.all([...keys].map((k) => this.store.setAppSetting(ORG_ID, k, "")));
      return this.list();
    }
    const template = (await this.store.listTemplates(ORG_ID)).find((t) => t.id === templateId);
    if (!template) throw new NotFoundException("Template not found");
    await this.store.setAppSetting(ORG_ID, defaultTemplateKey(template.wabaId), templateId);
    return this.list();
  }

  create(input: CreateTemplateInput): Promise<Template> {
    return this.store.createTemplate(ORG_ID, input);
  }

  async update(id: string, input: UpdateTemplateInput): Promise<Template> {
    const t = await this.store.updateTemplate(id, input);
    if (!t) throw new NotFoundException("Template not found");
    return t;
  }

  remove(id: string): Promise<void> {
    return this.store.deleteTemplate(id);
  }

  /**
   * Pull templates from **every** connected WhatsApp account.
   *
   * This used to sync the first WhatsApp inbox that happened to carry a WABA id
   * — and `listInboxes()` has no ordering, so which account that was could
   * change between calls. Combined with a sync that only ever inserted, a
   * workspace with two accounts accumulated the union of both into one
   * undifferentiated list, which looked like a feature and was in fact a
   * non-deterministic picker plus an append-only store. Roughly half of that
   * list would fail at Meta depending on which number was sending.
   *
   * Now: every account, each template tagged with the account it came from, and
   * anything Meta no longer has for that account removed.
   */
  async syncFromMeta(): Promise<{ synced: number; pruned: number }> {
    const accounts = await this.whatsAppAccounts();
    if (!accounts.length) return { synced: 0, pruned: 0 };
    let synced = 0;
    let pruned = 0;
    for (const account of accounts) {
      const result = await this.syncAccount(account);
      synced += result.synced;
      pruned += result.pruned;
    }
    this.logger.log(
      `Synced ${synced} template(s) from ${accounts.length} WhatsApp account(s)` +
        (pruned ? `, removed ${pruned} no longer at Meta` : ""),
    );
    return { synced, pruned };
  }

  /** One account's templates. Isolated so one bad token doesn't stop the rest. */
  private async syncAccount(account: { wabaId: string; token: string }): Promise<{
    synced: number;
    pruned: number;
  }> {
    try {
      const url =
        `https://graph.facebook.com/${env.whatsapp.apiVersion}/${account.wabaId}` +
        `/message_templates?limit=100`;
      // The token goes in the header, never the query string: a URL ends up in
      // proxy logs and in the error message below.
      const res = await fetch(url, { headers: { authorization: `Bearer ${account.token}` } });
      const json = (await res.json()) as { data?: MetaTemplate[]; error?: unknown };
      if (!res.ok || !json.data) {
        this.logger.warn(
          `Template sync for WABA ${account.wabaId} HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`,
        );
        return { synced: 0, pruned: 0 };
      }
      let synced = 0;
      const seen: Array<{ name: string; language: string }> = [];
      for (const t of json.data) {
        const body = t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text;
        if (!body) continue;
        await this.store.upsertTemplateByName(ORG_ID, {
          name: t.name,
          language: t.language,
          category: normalizeCategory(t.category),
          body,
          approvalStatus: normalizeStatus(t.status),
          wabaId: account.wabaId,
        });
        seen.push({ name: t.name, language: t.language });
        synced++;
      }
      // Only prune on a response we actually understood. An empty `data` from a
      // permissions problem would otherwise wipe the account's templates.
      const pruned = await this.store.pruneTemplatesForWaba(ORG_ID, account.wabaId, seen);
      return { synced, pruned };
    } catch (err) {
      this.logger.warn(`Template sync for WABA ${account.wabaId} failed: ${String(err)}`);
      return { synced: 0, pruned: 0 };
    }
  }

  /**
   * Every distinct WhatsApp account across the workspace's channels.
   *
   * Deduplicated by WABA, because two numbers can sit under one account and
   * syncing it twice would just do the same work again.
   */
  private async whatsAppAccounts(): Promise<Array<{ wabaId: string; token: string }>> {
    const byWaba = new Map<string, { wabaId: string; token: string }>();
    for (const inbox of await this.store.listInboxes()) {
      if (inbox.type !== "whatsapp" && inbox.type !== "whatsapp_group") continue;
      const cfg = await this.store.getInboxConfig(inbox.id);
      if (cfg?.wabaId && cfg?.accessToken && !byWaba.has(cfg.wabaId)) {
        byWaba.set(cfg.wabaId, { wabaId: cfg.wabaId, token: cfg.accessToken });
      }
    }
    return [...byWaba.values()];
  }
}

function normalizeCategory(c?: string): TemplateCategory {
  switch ((c ?? "").toUpperCase()) {
    case "MARKETING": return "marketing";
    case "AUTHENTICATION": return "authentication";
    default: return "utility";
  }
}

function normalizeStatus(s?: string): TemplateApproval {
  switch ((s ?? "").toUpperCase()) {
    case "APPROVED": return "approved";
    case "REJECTED": return "rejected";
    case "PAUSED": return "paused";
    case "DISABLED": return "disabled";
    case "PENDING":
    case "PENDING_DELETION":
    case "IN_APPEAL": return "pending";
    default: return "pending";
  }
}
