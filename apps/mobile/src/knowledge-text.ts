import { parseEmail, type Block } from "./email-html";

/**
 * SOP instructions and customer notes are written on the web in a small rich
 * text editor and stored as sanitised HTML (headings, lists, bold, italic,
 * links). The phone reads them with the email parser — same tags, same need —
 * and edits them as plain text with two conventions anyone can type:
 *
 *   a blank line starts a new paragraph;
 *   "- " (or "• ") starts a bullet, "1. " a numbered step.
 *
 * Bold, italics and links can't be typed that way, so editing a piece that has
 * them keeps the words and loses the styling. `hasFormatting` lets the form say
 * so before anyone saves.
 */

/** Blocks to draw. Empty input is no blocks. */
export function knowledgeBlocks(html: string): Block[] {
  if (!html.trim()) return [];
  return parseEmail(html, "").body;
}

/** The text a phone edits, from stored HTML. */
export function htmlToKnowledgeText(html: string): string {
  if (!html.trim()) return "";
  // Numbered lists come back as plain items from the block parser, so they are
  // numbered here from the HTML itself.
  const ordered = orderedItemTexts(html);
  let n = 0;
  const lines: string[] = [];
  for (const b of knowledgeBlocks(html)) {
    const text = b.spans
      .map((s) => s.text)
      .join("")
      .trim();
    if (!text) continue;
    if (b.kind === "li") {
      if (ordered.has(text)) lines.push(`${++n}. ${text}`);
      else lines.push(`- ${text}`);
      continue;
    }
    n = 0;
    if (lines.length) lines.push("");
    lines.push(text);
    lines.push("");
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Stored HTML, from what was typed. */
export function knowledgeTextToHtml(text: string): string {
  const out: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(escapeHtml).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flushList();
    if (!line) flushPara();
    else para.push(line);
  }
  flushPara();
  flushList();
  return out.join("");
}

/** Whether saving typed text would drop styling the web gave it. */
export function hasFormatting(html: string): boolean {
  return /<(strong|b|em|i|u|a|h[1-6]|blockquote)\b/i.test(html);
}

function orderedItemTexts(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi)) {
    for (const li of m[1]!.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const t = knowledgeBlocks(`<p>${li[1]}</p>`)
        .map((b) => b.spans.map((s) => s.text).join(""))
        .join(" ")
        .trim();
      if (t) out.add(t);
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
