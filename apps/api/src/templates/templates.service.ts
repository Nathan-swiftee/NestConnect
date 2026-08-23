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

/* The org setting holding the default template's id. Empty string = none. */
const DEFAULT_TEMPLATE_KEY = "wa_default_template_id";

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

  /** Templates, with the workspace default flagged. The default is an org
   *  setting rather than a column on the row: it's one value for the whole
   *  workspace, and keeping it here means only one template can ever hold it. */
  async list(): Promise<Template[]> {
    const [templates, defaultId] = await Promise.all([
      this.store.listTemplates(ORG_ID),
      this.store.getAppSetting(ORG_ID, DEFAULT_TEMPLATE_KEY),
    ]);
    return templates.map((t) => ({ ...t, isDefault: t.id === defaultId }));
  }

  /** Point the default at a template, or clear it with null. */
  async setDefault(templateId: string | null): Promise<Template[]> {
    if (templateId) {
      const exists = (await this.store.listTemplates(ORG_ID)).some((t) => t.id === templateId);
      if (!exists) throw new NotFoundException("Template not found");
    }
    await this.store.setAppSetting(ORG_ID, DEFAULT_TEMPLATE_KEY, templateId ?? "");
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
   * Pull approved templates from Meta for the first connected WhatsApp number
   * that carries a WABA id + token. A no-op (synced: 0) with no live number.
   */
  async syncFromMeta(): Promise<{ synced: number }> {
    const creds = await this.wabaCreds();
    if (!creds) return { synced: 0 };
    try {
      const url =
        `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.wabaId}` +
        `/message_templates?limit=100&access_token=${encodeURIComponent(creds.token)}`;
      const res = await fetch(url);
      const json = (await res.json()) as { data?: MetaTemplate[]; error?: unknown };
      if (!res.ok || !json.data) {
        this.logger.warn(`Template sync HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`);
        return { synced: 0 };
      }
      let synced = 0;
      for (const t of json.data) {
        const body = t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text;
        if (!body) continue;
        await this.store.upsertTemplateByName(ORG_ID, {
          name: t.name,
          language: t.language,
          category: normalizeCategory(t.category),
          body,
          approvalStatus: normalizeStatus(t.status),
        });
        synced++;
      }
      this.logger.log(`Synced ${synced} template(s) from Meta`);
      return { synced };
    } catch (err) {
      this.logger.warn(`Template sync failed: ${String(err)}`);
      return { synced: 0 };
    }
  }

  /** WABA id + access token from the first WhatsApp inbox that has them. */
  private async wabaCreds(): Promise<{ wabaId: string; token: string } | null> {
    for (const inbox of await this.store.listInboxes()) {
      if (inbox.type !== "whatsapp") continue;
      const cfg = await this.store.getInboxConfig(inbox.id);
      if (cfg?.wabaId && cfg?.accessToken) return { wabaId: cfg.wabaId, token: cfg.accessToken };
    }
    return null;
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
