import { Injectable } from "@nestjs/common";
import { IngestService } from "../ingest.service";
import { htmlToText } from "./html-sanitize";

/**
 * Inbound email webhook body. Tolerant of Postmark's shape (From/FromFull/
 * ToFull/Subject/TextBody/Headers) and a simple generic shape.
 */
export interface EmailWebhookBody {
  From?: string;
  FromName?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  ToFull?: Array<{ Email?: string; Name?: string }>;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  MessageID?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
  // lowercase generic fallbacks
  from?: string;
  fromName?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  references?: string[];
}

function extractAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

@Injectable()
export class EmailService {
  constructor(private readonly ingest: IngestService) {}

  async handleWebhook(body: EmailWebhookBody): Promise<{ handled: number }> {
    const header = (name: string) =>
      body.Headers?.find((h) => h.Name?.toLowerCase() === name.toLowerCase())?.Value;

    const from = body.FromFull?.Email || body.From || body.from || "";
    const fromName = body.FromFull?.Name || body.FromName || body.fromName;
    const toAddress = extractAddress(body.ToFull?.[0]?.Email || body.To || body.to || "");
    const subject = body.Subject || body.subject;
    const html = body.HtmlBody || body.html;
    // Fall back to text derived from the HTML when the sender gave no plain part.
    const text = body.TextBody || body.StrippedTextReply || body.text || (html ? htmlToText(html) : "");
    const messageId = header("Message-ID") || body.MessageID || body.messageId;

    const refsRaw = `${header("References") ?? ""} ${header("In-Reply-To") ?? ""}`;
    const references = [
      ...new Set(
        [...(body.references ?? []), ...refsRaw.split(/\s+/)].map((s) => s.trim()).filter(Boolean),
      ),
    ];

    if (!from || !toAddress) return { handled: 0 };

    const res = await this.ingest.ingestEmail({
      toAddress,
      from,
      fromName,
      subject,
      text,
      html,
      messageId,
      references,
    });
    return { handled: res ? 1 : 0 };
  }
}
