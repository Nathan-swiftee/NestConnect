import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { BroadcastResult, SendBroadcastInput } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";
import { metaErrorMessage, resolveWhatsAppCreds } from "../channels/whatsapp/whatsapp-creds";

/** How many recipient sends run at once — bounded so a big list doesn't hammer
 *  Meta's rate limits, while still finishing a typical broadcast quickly. */
const CONCURRENCY = 8;

/**
 * WhatsApp broadcasts. WhatsApp has no true one-to-many primitive — the
 * compliant way to reach many people is to send each of them an approved
 * template as an individual 1:1 message. This service does exactly that: it
 * loops the recipients (with a little concurrency) and reports per-recipient
 * success/failure. Recipients who reply come back as normal inbound
 * conversations via the webhook, so nothing else has to be wired here.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(private readonly store: Store) {}

  async send(input: SendBroadcastInput): Promise<BroadcastResult> {
    const inbox = await this.store.getInbox(input.inboxId);
    if (!inbox || inbox.type !== "whatsapp") {
      throw new BadRequestException("Pick a WhatsApp number to broadcast from.");
    }
    const creds = await resolveWhatsAppCreds(this.store, input.inboxId);
    if (!creds) {
      throw new BadRequestException(
        "This WhatsApp number isn't connected yet — add its Phone number ID and access token under Channels first.",
      );
    }

    const template = await this.store.getTemplate(input.templateId);
    if (!template) throw new NotFoundException("Template not found");
    if (template.approvalStatus !== "approved") {
      throw new BadRequestException(
        `Template “${template.name}” isn't approved by Meta yet — only approved templates can be broadcast.`,
      );
    }

    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`;
    const recipients = input.recipients;
    const results: BroadcastResult["results"] = new Array(recipients.length);

    // A shared cursor consumed by a fixed pool of workers. `cursor++` is atomic
    // here (no await between read and increment on a single-threaded runtime),
    // so each recipient is handled exactly once.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = cursor++;
        if (i >= recipients.length) return;
        const r = recipients[i];
        const params = (r.params && r.params.length ? r.params : input.params) ?? [];
        results[i] = await this.sendOne(
          url,
          creds.accessToken,
          r.phone,
          template.name,
          template.language,
          params,
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, recipients.length) }, () => worker()),
    );

    const sent = results.filter((x) => x.ok).length;
    const failed = results.length - sent;
    this.logger.log(
      `Broadcast "${template.name}" from inbox ${input.inboxId}: ${sent} sent, ${failed} failed (${results.length} total)`,
    );
    return { total: results.length, sent, failed, results };
  }

  /** Send the template to one recipient, mapping any error to a short reason. */
  private async sendOne(
    url: string,
    accessToken: string,
    phone: string,
    name: string,
    language: string,
    params: string[],
  ): Promise<{ phone: string; ok: boolean; error?: string }> {
    const components = params.length
      ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
      : [];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: { name, language: { code: language }, components },
        }),
      });
      const json = (await res.json()) as { error?: unknown };
      if (!res.ok) return { phone, ok: false, error: metaErrorMessage(json.error, res.status) };
      return { phone, ok: true };
    } catch (err) {
      return { phone, ok: false, error: String(err) };
    }
  }
}
