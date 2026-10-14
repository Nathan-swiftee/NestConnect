import { z } from "zod";

/*
 * Email signatures — one design per email channel, filled in per sender.
 *
 * An admin lays the signature out once for a mailbox (Settings › Channels ›
 * Signature) using tags — {{agent.name}}, {{agent.position}} — and adds a
 * marketing section underneath (a banner, links, a legal line). Every email
 * sent from that mailbox carries it with the sender's own details filled in.
 *
 * Rendered in one place, here, so the settings preview, the composer's hint
 * and the email that actually goes out can't disagree.
 */

export const SIGNATURE_TOKENS = [
  { token: "agent.name", label: "Name", sample: "Nathan A" },
  { token: "agent.first_name", label: "First name", sample: "Nathan" },
  { token: "agent.position", label: "Position", sample: "Operations Manager" },
  { token: "agent.email", label: "Their email", sample: "nathan@swiftee.co.uk" },
  { token: "team.name", label: "Team", sample: "Support team" },
  { token: "channel.name", label: "Channel name", sample: "Swiftee Support" },
  { token: "channel.email", label: "Channel email", sample: "support@swiftee.co.uk" },
] as const;
export type SignatureToken = (typeof SIGNATURE_TOKENS)[number]["token"];

/** What a mailbox signs with before an admin has designed its own. */
export const DEFAULT_SIGNATURE_LAYOUT =
  "<p><strong>{{agent.name}}</strong><br>{{agent.position}}<br>{{channel.email}}</p>";

/** A mailbox's saved design. `layoutHtml` null = never designed (the default
 *  applies); an empty string = deliberately no name block. */
export const inboxSignatureSchema = z.object({
  layoutHtml: z.string().nullable(),
  footerHtml: z.string().nullable(),
});
export type InboxSignature = z.infer<typeof inboxSignatureSchema>;

/** Body for PUT /inboxes/:id/signature. Images are hosted URLs, so this is
 *  headroom for markup, not for base64. */
export const updateInboxSignatureInputSchema = z.object({
  layoutHtml: z.string().max(200000).nullable(),
  footerHtml: z.string().max(200000).nullable(),
});
export type UpdateInboxSignatureInput = z.infer<typeof updateInboxSignatureInputSchema>;

/** A person's job title, shown in signatures. Blank clears it (stored as none). */
export const positionInputSchema = z.string().trim().max(80, "Keep the position under 80 characters");

/** The facts a signature fills from. Missing ones drop their line. */
export interface SignatureContext {
  agentName?: string | null;
  agentPosition?: string | null;
  agentEmail?: string | null;
  teamName?: string | null;
  channelName?: string | null;
  channelEmail?: string | null;
}

/** The context the settings preview uses when nobody real is picked. */
export const SIGNATURE_SAMPLE: SignatureContext = {
  agentName: "Nathan A",
  agentPosition: "Operations Manager",
  agentEmail: "nathan@swiftee.co.uk",
  teamName: "Support team",
  channelName: "Swiftee Support",
  channelEmail: "support@swiftee.co.uk",
};

function tokenValue(token: string, ctx: SignatureContext): string | null {
  const v = (s?: string | null) => (s ?? "").trim();
  switch (token) {
    case "agent.name":
      return v(ctx.agentName);
    case "agent.first_name":
      return v(ctx.agentName).split(/\s+/)[0] ?? "";
    case "agent.position":
      return v(ctx.agentPosition);
    case "agent.email":
      return v(ctx.agentEmail);
    case "team.name":
      return v(ctx.teamName);
    case "channel.name":
      return v(ctx.channelName);
    case "channel.email":
      return v(ctx.channelEmail);
    default:
      return null; // not ours: left as written
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TOKEN = /\{\{\s*([a-z_.]+)\s*\}\}/gi;
/** "·", "|", "-", "," … with any spaces around them, as typed in an editor. */
const SEP = String.raw`(?:\s|&nbsp;| )*(?:·|&middot;|\||•|&bull;|–|&ndash;|—|&mdash;|-|,)(?:\s|&nbsp;| )*`;
/** What ends one visual line of a signature. */
const LINE_END = /(<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>)/i;

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;| /g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "x");

/**
 * Fill one line. A tag with nothing behind it takes a separator next to it
 * along ("Manager · {{team.name}}" → "Manager"), and a line left with nothing
 * but punctuation is dropped — so somebody with no position doesn't get a
 * blank line or a stray "·".
 */
function fillLine(line: string, ctx: SignatureContext): { html: string; drop: boolean } {
  let html = line;
  let hadEmpty = false;
  for (const m of [...line.matchAll(TOKEN)]) {
    const token = m[1]!.toLowerCase();
    if (tokenValue(token, ctx) !== "") continue;
    hadEmpty = true;
    const tag = m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = new RegExp(SEP + tag);
    const after = new RegExp(tag + SEP);
    html = before.test(html) ? html.replace(before, "") : after.test(html) ? html.replace(after, "") : html.replace(m[0], "");
  }
  html = html.replace(TOKEN, (whole, t: string) => {
    const value = tokenValue(t.toLowerCase(), ctx);
    return value === null ? whole : escapeHtml(value);
  });
  const empty = !/<img\b/i.test(html) && textOf(html).replace(/[\s·|•–—,\-:]/g, "") === "";
  return { html, drop: hadEmpty && empty };
}

/** Fill a piece of signature HTML line by line, dropping lines that came out empty. */
export function fillSignatureHtml(html: string, ctx: SignatureContext): string {
  const parts = html.split(LINE_END);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] ?? "";
    const end = parts[i + 1] ?? "";
    const { html: filled, drop } = fillLine(line, ctx);
    if (!drop) {
      out += filled + end;
      continue;
    }
    // Keep the markup (an opening <p> needs its </p>), lose the words; a <br>
    // goes with the line it ended.
    const tags = (filled.match(/<[^>]*>/g) ?? []).join("");
    out += /^<br/i.test(end) ? tags : tags + end;
  }
  // A paragraph left with nothing in it, and a <br> left trailing a paragraph.
  return out
    .replace(/<p[^>]*>(?:\s|<br\s*\/?>|<(?!img)[^>]*>)*<\/p>/gi, (p) => (textOf(p).trim() || /<img/i.test(p) ? p : ""))
    .replace(/(?:<br\s*\/?>\s*)+(<\/(?:p|div|li|h[1-6])>)/gi, "$1")
    .trim();
}

/**
 * The signature an email from this mailbox carries, for this sender: the
 * layout (or the default when the mailbox has none yet), then the marketing
 * section. Empty when there's nothing to add.
 */
export function renderEmailSignature(signature: InboxSignature | null | undefined, ctx: SignatureContext): string {
  const layout = signature?.layoutHtml ?? DEFAULT_SIGNATURE_LAYOUT;
  const top = layout.trim() ? stackBlockImages(fillSignatureHtml(layout, ctx)) : "";
  const footer = signature?.footerHtml?.trim() ? stackBlockImages(fillSignatureHtml(signature.footerHtml, ctx)) : "";
  const hasText = (h: string) => !!textOf(h).trim() || /<img\b/i.test(h);
  return [top, footer].filter(hasText).join("<br>");
}

/** Elements that hold no content, so never open a level of nesting. */
const VOID_TAGS = new Set(["img", "br", "hr", "wbr", "input", "meta", "link", "source", "col", "area", "base", "embed", "track"]);

/**
 * Give each image that stands on its own line a line of its own in the mail.
 *
 * The signature editor keeps a picture as a block of its own (a logo, then a
 * banner under it), and writes it out as a bare `<img>` between paragraphs.
 * In the editor that reads as a block. In a mail client an `<img>` is inline,
 * so two in a row sit side by side, and one next to a line of text sits beside
 * it. Wrapping each top-level image in a `<div>` keeps the layout the editor
 * showed.
 *
 * Only images at the top level are touched. One inside a paragraph, a link
 * or a table cell was put there on purpose (an icon in a line of text) and
 * stays inline.
 */
export function stackBlockImages(html: string): string {
  let depth = 0;
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g, (tag, closing: string, name: string, selfClosing: string) => {
    const lower = name.toLowerCase();
    if (lower === "img") return depth === 0 ? `<div>${tag}</div>` : tag;
    if (VOID_TAGS.has(lower) || selfClosing) return tag;
    depth = closing ? Math.max(0, depth - 1) : depth + 1;
    return tag;
  });
}

/** "Nathan A · Operations Manager" — the composer's one-line "signed as". */
export function signedAsLine(ctx: SignatureContext): string {
  return [ctx.agentName, ctx.agentPosition]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}
