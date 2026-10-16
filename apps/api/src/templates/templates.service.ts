import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  templateDefaults,
  type CreateTemplateInput,
  type Template,
  type TemplateApproval,
  type TemplateCategory,
  type UpdateTemplateInput,
} from "@ding/schemas";
import { env } from "../config/env";
import { currentOrgId, runInTenant } from "../tenancy/tenant-scope";
import { Store } from "../data/store";
import { SandboxPolicy } from "../tenancy/sandbox";
import { sameTemplateLang, templateVariableCount } from "../data/mappers";

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

/** When each account's templates were last synced from Meta (an ISO time). */
const syncedAtKey = (wabaId: string) => `wa_templates_synced_at:${wabaId}`;
/** How often the background job looks for accounts that are due. */
const SWEEP_MS = 5 * 60_000;
/** An account's templates are refreshed this often… */
const SYNC_EVERY_MS = 60 * 60_000;
/** …or this often while one of them is waiting on Meta's review, so an approval
 *  shows up in minutes rather than in up to an hour. */
const SYNC_PENDING_EVERY_MS = 10 * 60_000;

/** Example values Meta's reviewers see for a template's variables. */
const SAMPLE_FILL = {
  contactName: "Alex Taylor",
  contactCompany: "Bloom Florists",
  contactPhone: "+44 7700 900123",
  contactEmail: "alex@example.com",
  agentName: "Sam Jones",
  channelName: "Swiftee",
};

/** A Graph API reply: the payload, or Meta's error. */
interface GraphReply<T> {
  ok: boolean;
  status: number;
  json: T & { error?: { message?: string; error_user_title?: string; error_user_msg?: string; code?: number } };
}

/** The subset of Meta's message-template payload we read when syncing. */
interface MetaTemplate {
  id?: string;
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
export class TemplatesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TemplatesService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly store: Store,
    private readonly sandbox: SandboxPolicy,
  ) {}

  onApplicationBootstrap(): void {
    // Real WhatsApp accounts only live in a real database; the in-memory demo's
    // channels have no token Meta would accept.
    if (!env.usingDatabase) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
    // Shortly after a start too, rather than five minutes in.
    setTimeout(() => void this.sweep(), 30_000).unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Every template, each flagged if it is the default *for its own account*.
   *
   * The default lives in an org setting rather than a column, so that exactly
   * one template per account can hold it — a column would let two rows both
   * claim it and leave the winner to whichever query ran first.
   */
  async list(): Promise<Template[]> {
    const templates = await this.store.listTemplates(currentOrgId());
    // One lookup per distinct account, not one per template.
    const wabaIds = [...new Set(templates.map((t) => t.wabaId).filter(Boolean))] as string[];
    const legacy = (await this.store.getAppSetting(currentOrgId(), DEFAULT_TEMPLATE_KEY)) ?? "";
    const defaults = new Map<string, string>();
    await Promise.all(
      wabaIds.map(async (wabaId) => {
        const own = await this.store.getAppSetting(currentOrgId(), defaultTemplateKey(wabaId));
        // Fall back to the pre-accounts setting so a workspace that had a
        // default before templates were scoped does not silently lose it —
        // but only when that template is this account's: one linked to no
        // account, or to another, is one this account's numbers can't send.
        const fallback = templates.some((t) => t.id === legacy && t.wabaId === wabaId) ? legacy : "";
        const id = own || fallback;
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
  async setDefault(templateId: string | null, isDefault?: boolean): Promise<Template[]> {
    // A pre-change client sent a bare `null` to unstar. It named no account, so
    // clearing every account's key is the only thing recoverable from it — the
    // old behaviour, kept because refusing the request instead would break a
    // screen somebody still has open rather than fix anything.
    if (templateId === null) {
      const all = await this.store.listTemplates(currentOrgId());
      const keys = new Set(all.map((t) => defaultTemplateKey(t.wabaId)));
      keys.add(DEFAULT_TEMPLATE_KEY);
      await Promise.all([...keys].map((k) => this.store.setAppSetting(currentOrgId(), k, "")));
      return this.list();
    }
    // And sending an id with nothing else always meant "make this the default".
    const starred = isDefault ?? true;
    const template = (await this.store.listTemplates(currentOrgId())).find((t) => t.id === templateId);
    if (!template) throw new NotFoundException("Template not found");
    const key = defaultTemplateKey(template.wabaId);
    if (!starred) {
      await this.store.setAppSetting(currentOrgId(), key, "");
      // An unclaimed template answers to the bare key, which is also the
      // fallback every account reads when it has none of its own. Clearing it
      // has to clear it there too, or unstarring would appear to do nothing.
      if (!template.wabaId) await this.store.setAppSetting(currentOrgId(), DEFAULT_TEMPLATE_KEY, "");
      return this.list();
    }
    await this.store.setAppSetting(currentOrgId(), key, templateId);
    return this.list();
  }

  /**
   * A new template. With an account, it is submitted to Meta for approval on
   * that account and kept only if Meta accepts the submission — so what's listed
   * under an account is always something Meta has. Without one it's kept here
   * only, linked to no account, which no number can send.
   */
  async create(input: CreateTemplateInput): Promise<Template> {
    if (!input.wabaId) return this.store.createTemplate(currentOrgId(), input);
    return this.submitToMeta(input, input.wabaId);
  }

  /** Submit a template that's linked to no account to Meta, on this account. */
  async submit(id: string, wabaId: string): Promise<Template> {
    const tpl = await this.store.getTemplate(id);
    if (!tpl) throw new NotFoundException("Template not found");
    if (tpl.wabaId) throw new BadRequestException(`“${tpl.name}” is already on a WhatsApp account`);
    return this.submitToMeta(
      { name: tpl.name, category: tpl.category, language: tpl.language, body: tpl.body, variableDefaults: tpl.variableDefaults ?? [] },
      wabaId,
    );
  }

  /**
   * Change a template. One that's on an account is Meta's: its name, wording,
   * category and language are whatever Meta approved, and the next sync would
   * put them back. What we pre-fill its variables with is ours, so that stays
   * editable.
   */
  async update(id: string, input: UpdateTemplateInput): Promise<Template> {
    const current = await this.store.getTemplate(id);
    if (!current) throw new NotFoundException("Template not found");
    if (current.wabaId) {
      const metaOwned = (["name", "category", "language", "body", "approvalStatus"] as const).filter(
        (k) => input[k] !== undefined && input[k] !== current[k],
      );
      if (metaOwned.length) {
        throw new BadRequestException(
          `“${current.name}” is approved by Meta as it is, so its ${metaOwned.join(", ")} can't be changed here. ` +
            "Create a new template instead, and delete this one if it's no longer needed.",
        );
      }
      input = { variableDefaults: input.variableDefaults };
    }
    const t = await this.store.updateTemplate(id, input);
    if (!t) throw new NotFoundException("Template not found");
    return t;
  }

  /**
   * Delete a template. One on an account is deleted at Meta too — otherwise the
   * next sync would bring it straight back.
   */
  async remove(id: string): Promise<void> {
    const tpl = await this.store.getTemplate(id);
    if (!tpl) return;
    if (tpl.wabaId) {
      await this.sandbox.assertLive("Deleting a template at Meta");
      const token = await this.tokenFor(tpl.wabaId);
      const metaId = await this.metaIdOf(tpl.wabaId, token, tpl.name, tpl.language);
      if (metaId) {
        const res = await this.graph<{ success?: boolean }>(
          "DELETE",
          `${tpl.wabaId}/message_templates?hsm_id=${encodeURIComponent(metaId)}&name=${encodeURIComponent(tpl.name)}`,
          token,
        );
        if (!res.ok) throw new BadRequestException(`Meta didn't delete “${tpl.name}”: ${metaError(res)}`);
      }
      // Not at Meta (already deleted there): nothing to do but forget it here.
    }
    await this.store.deleteTemplate(id);
  }

  private async submitToMeta(input: Omit<CreateTemplateInput, "wabaId">, wabaId: string): Promise<Template> {
    await this.sandbox.assertLive("Submitting a template to Meta");
    const token = await this.tokenFor(wabaId);
    const variables = templateVariableCount(input.body);
    const component: Record<string, unknown> = { type: "BODY", text: input.body };
    if (variables) {
      // Meta won't review a template with variables without an example of each.
      const filled = templateDefaults({ variableCount: variables, variableDefaults: input.variableDefaults }, SAMPLE_FILL);
      component.example = { body_text: [filled.map((v, i) => v.trim() || `example ${i + 1}`)] };
    }
    const res = await this.graph<{ id?: string; status?: string; category?: string }>("POST", `${wabaId}/message_templates`, token, {
      name: input.name,
      language: input.language,
      category: input.category.toUpperCase(),
      // Meta may file it under another category than asked; accept that rather
      // than have it rejected outright.
      allow_category_change: true,
      components: [component],
    });
    if (!res.ok || !res.json.id) {
      throw new BadRequestException(`Meta didn't accept “${input.name}”: ${metaError(res)}`);
    }
    const saved = await this.store.upsertTemplateByName(currentOrgId(), {
      name: input.name,
      language: input.language,
      category: res.json.category ? normalizeCategory(res.json.category) : input.category,
      body: input.body,
      approvalStatus: normalizeStatus(res.json.status),
      wabaId,
    });
    // Check back on it soon: the review usually takes minutes.
    await this.store.setAppSetting(currentOrgId(), syncedAtKey(wabaId), new Date().toISOString());
    const withDefaults = input.variableDefaults?.length
      ? await this.store.updateTemplate(saved.id, { variableDefaults: input.variableDefaults })
      : saved;
    return withDefaults ?? saved;
  }

  /** Meta's id for a template, which deleting one language of it needs. */
  private async metaIdOf(wabaId: string, token: string, name: string, language: string): Promise<string | null> {
    const res = await this.graph<{ data?: MetaTemplate[] }>(
      "GET",
      `${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,language`,
      token,
    );
    if (!res.ok) throw new BadRequestException(`Couldn't find “${name}” at Meta: ${metaError(res)}`);
    const rows = (res.json.data ?? []).filter((t) => t.name === name);
    const exact = rows.find((t) => t.language === language) ?? rows.find((t) => sameTemplateLang(t.language, language));
    return exact?.id ?? null;
  }

  /** The access token for one of this workspace's accounts. */
  private async tokenFor(wabaId: string): Promise<string> {
    const account = (await this.whatsAppAccounts()).find((a) => a.wabaId === wabaId);
    if (!account) throw new BadRequestException("That WhatsApp account isn't connected to this workspace");
    return account.token;
  }

  /**
   * One Graph API call. The token goes in the header, never the query string:
   * a URL ends up in proxy logs and in error messages. A seam the checks
   * replace, so nothing in them reaches Meta.
   */
  protected async graph<T>(method: "GET" | "POST" | "DELETE", path: string, token: string, body?: unknown): Promise<GraphReply<T>> {
    const res = await fetch(`https://graph.facebook.com/${env.whatsapp.apiVersion}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as GraphReply<T>["json"];
    return { ok: res.ok && !json.error, status: res.status, json };
  }

  /* ---- keeping up with Meta ---- */

  /**
   * Every workspace's accounts that are due a sync: never synced (just
   * connected), not for an hour, or not for ten minutes while a template is
   * waiting on Meta's review. Demo workspaces are left alone.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const inboxes = [
        ...(await this.store.listInboxesAcrossWorkspaces("whatsapp")),
        ...(await this.store.listInboxesAcrossWorkspaces("whatsapp_group")),
      ];
      for (const orgId of new Set(inboxes.map((i) => i.orgId))) {
        if (await this.sandbox.isSandbox(orgId)) continue;
        await runInTenant(orgId, () => this.syncDue()).catch((err) =>
          this.logger.warn(`Template sync for workspace ${orgId} failed: ${String(err)}`),
        );
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** This workspace's accounts that are due, synced. Returns how many were. */
  async syncDue(now = new Date()): Promise<number> {
    const templates = await this.store.listTemplates(currentOrgId());
    let synced = 0;
    for (const account of await this.whatsAppAccounts()) {
      const last = await this.store.getAppSetting(currentOrgId(), syncedAtKey(account.wabaId));
      const pending = templates.some((t) => t.wabaId === account.wabaId && t.approvalStatus === "pending");
      const age = last ? now.getTime() - new Date(last).getTime() : Infinity;
      if (age < (pending ? SYNC_PENDING_EVERY_MS : SYNC_EVERY_MS)) continue;
      await this.syncAccount(account);
      synced++;
    }
    return synced;
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
    await this.sandbox.assertLive("Syncing templates from Meta");
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
      // Recorded before the call, so an account whose token is broken is
      // retried on the hourly cadence rather than every five minutes.
      await this.store.setAppSetting(currentOrgId(), syncedAtKey(account.wabaId), new Date().toISOString());
      const res = await this.graph<{ data?: MetaTemplate[] }>(
        "GET",
        `${account.wabaId}/message_templates?limit=250&fields=id,name,language,status,category,components`,
        account.token,
      );
      const json = res.json;
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
        await this.store.upsertTemplateByName(currentOrgId(), {
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
      const pruned = await this.store.pruneTemplatesForWaba(currentOrgId(), account.wabaId, seen);
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

/** What Meta said went wrong, in the words it gives people where it has some. */
function metaError(res: GraphReply<unknown>): string {
  const e = res.json.error;
  return e?.error_user_msg || e?.error_user_title || e?.message || `HTTP ${res.status}`;
}

