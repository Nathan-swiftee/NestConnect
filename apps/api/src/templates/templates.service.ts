import { Injectable, Logger, NotFoundException } from "@nestjs/common";
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
   * Every template, each flagged if it is the default *for its own account*.
   *
   * The default lives in an org setting rather than a column, so that exactly
   * one template per account can hold it — a column would let two rows both
   * claim it and leave the winner to whichever query ran first.
   */
  async list(): Promise<Template[]> {
    const templates = await this.store.listTemplates(ORG_ID);
    // One lookup per distinct account, not one per template.
    const wabaIds = [...new Set(templates.map((t) => t.wabaId).filter(Boolean))] as string[];
    const legacy = (await this.store.getAppSetting(ORG_ID, DEFAULT_TEMPLATE_KEY)) ?? "";
    const defaults = new Map<string, string>();
    await Promise.all(
      wabaIds.map(async (wabaId) => {
        const own = await this.store.getAppSetting(ORG_ID, defaultTemplateKey(wabaId));
        // Fall back to the pre-accounts setting so a workspace that had a
        // default before templates were scoped does not silently lose it.
        const id = own || legacy;
        if (id) defaults.set(wabaId, id);
      }),
    );
    return templates.map((t) => ({
      ...t,
      // An unclaimed template still answers to the old workspace-wide setting:
      // it belongs to no account, so there is no per-account key to consult.
      isDefault: t.wabaId ? defaults.get(t.wabaId) === t.id : Boolean(legacy) && legacy === t.id,
    }));
  }

  /**
   * Star a template as its account's default, or unstar it.
   *
   * Both directions are scoped to the template's own account, so one number's
   * default never disturbs another's. Unstarring used to take a bare `null` —
   * which named no account, so the only thing it could mean was "clear them
   * all". A workspace with two accounts lost both starred templates whenever
   * anybody unstarred either, which is indistinguishable from the setting not
   * holding.
   */
  async setDefault(templateId: string, isDefault: boolean): Promise<Template[]> {
    const template = (await this.store.listTemplates(ORG_ID)).find((t) => t.id === templateId);
    if (!template) throw new NotFoundException("Template not found");
    const key = defaultTemplateKey(template.wabaId);
    if (!isDefault) {
      await this.store.setAppSetting(ORG_ID, key, "");
      // An unclaimed template answers to the bare key, which is also the
      // fallback every account reads when it has none of its own. Clearing it
      // has to clear it there too, or unstarring would appear to do nothing.
      if (!template.wabaId) await this.store.setAppSetting(ORG_ID, DEFAULT_TEMPLATE_KEY, "");
      return this.list();
    }
    await this.store.setAppSetting(ORG_ID, key, templateId);
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
