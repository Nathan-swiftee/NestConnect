/**
 * Email bodies, turned into something React Native can lay out.
 *
 * The web renders these in a sandboxed iframe, which a phone has no equivalent
 * of. A WebView would be the closest thing, and it is the wrong trade here: a
 * whole browser per message, each one its own scroll container fighting the
 * thread's, for content that is — after the server's sanitiser has been over it
 * — a handful of paragraphs with some bold in them.
 *
 * So this parses instead. It is deliberately not a general HTML parser: it
 * handles the tags email actually arrives with and drops the rest, which is the
 * right failure mode. Anything unrecognised degrades to its text content rather
 * than disappearing, so an unusual sender's newsletter is plain and readable
 * instead of blank.
 *
 * Safety is not this file's job — the body has already been sanitised server
 * side (see the HTML sanitizer in the API, which strips scripts and blocks
 * remote images). This throws away `<script>` and `<style>` anyway, because
 * their *text content* would otherwise be rendered as prose, which is a
 * legibility bug rather than a security one.
 */

export type Span = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type Block = { kind: "p" | "h" | "li" | "quote"; spans: Span[] };
export type ParsedEmail = {
  /** The message itself. */
  body: Block[];
  /** The thread it was replying to, if it carried one. Collapsed by default. */
  quoted: Block[];
};

/** Named entities that actually turn up. Numeric forms are handled generically. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  pound: "£",
  euro: "€",
};

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Tags that end the current block and start a new one. */
const BLOCK = new Set([
  "p", "div", "br", "tr", "table", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "li", "section", "article", "header", "footer", "pre", "hr",
]);
const HEADING = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Where the reply ends and the thread it quotes begins.
 *
 * Every mail client marks this differently and none of them agree, so this
 * looks for the three that cover almost everything in practice: Gmail's
 * `gmail_quote` class, Outlook's `divRplyFwdMsg`/`appendonsend` divider, and the
 * `<blockquote>` that most clients wrap the previous message in. First match
 * wins, because a quoted thread contains all the earlier ones nested inside it.
 */
function splitQuoted(html: string): [string, string] {
  const markers = [
    /<div[^>]*class="[^"]*gmail_quote[^"]*"/i,
    /<div[^>]*id="(divRplyFwdMsg|appendonsend)"/i,
    /<blockquote/i,
    /<hr[^>]*id="stopSpelling"/i,
  ];
  let cut = -1;
  for (const re of markers) {
    const m = re.exec(html);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  return cut === -1 ? [html, ""] : [html.slice(0, cut), html.slice(cut)];
}

/** Walk the markup, emitting blocks of styled spans. */
function parseFragment(html: string, asQuote = false): Block[] {
  const blocks: Block[] = [];
  let spans: Span[] = [];
  let kind: Block["kind"] = asQuote ? "quote" : "p";
  // Depth counters rather than a stack of tags: email nests inline formatting
  // freely and often doesn't close it, and a counter can't be corrupted by a
  // stray `</b>` the way a stack can.
  let bold = 0;
  let italic = 0;
  let href: string | undefined;
  // Cells seen so far in the current table row. Email uses tables for layout
  // constantly, and without a separator the cells run together into one word —
  // "Garden roses (mixed)120£1.10" instead of three columns.
  let cell = 0;

  const flush = () => {
    // Collapse the runs of whitespace that indentation in the source leaves
    // behind, then drop the block if there was nothing but whitespace in it.
    const cleaned = spans
      .map((s) => ({ ...s, text: s.text.replace(/[ \t\r\n]+/g, " ") }))
      .filter((s) => s.text.length > 0);
    while (cleaned.length && !cleaned[0].text.trim()) cleaned.shift();
    while (cleaned.length && !cleaned[cleaned.length - 1].text.trim()) cleaned.pop();
    if (cleaned.length) blocks.push({ kind, spans: cleaned });
    spans = [];
    kind = asQuote ? "quote" : "p";
  };

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "");

  const token = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decode(raw);
    if (!text) return;
    spans.push({ text, bold: bold > 0 || undefined, italic: italic > 0 || undefined, href });
  };

  while ((m = token.exec(stripped)) !== null) {
    pushText(stripped.slice(last, m.index));
    last = token.lastIndex;

    const tag = m[1].toLowerCase();
    const closing = m[0][1] === "/";
    const attrs = m[2] ?? "";

    if (BLOCK.has(tag)) {
      flush();
      if (tag === "tr" || tag === "table") cell = 0;
      if (!closing) {
        if (HEADING.has(tag)) kind = "h";
        else if (tag === "li") kind = "li";
        else if (tag === "blockquote") kind = "quote";
      }
      continue;
    }

    // A row's cells stay on one line, separated so the columns are still
    // readable as columns. The separator goes *before* each cell after the
    // first, so a row never ends with a dangling one.
    if (tag === "td" || tag === "th") {
      if (!closing) {
        if (cell > 0) spans.push({ text: "  ·  " });
        cell += 1;
      }
      continue;
    }

    if (tag === "b" || tag === "strong") bold += closing ? -1 : 1;
    else if (tag === "i" || tag === "em") italic += closing ? -1 : 1;
    else if (tag === "a") {
      if (closing) href = undefined;
      else {
        const h = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const url = h ? (h[2] ?? h[3] ?? h[4] ?? "").trim() : "";
        // Only real, followable links become links. A `mailto:` or a tracking
        // redirect the sanitiser left in place is still fine to open; a
        // `javascript:` is not, and an anchor into a document that doesn't
        // exist here is pointless.
        href = /^(https?:|mailto:|tel:)/i.test(url) ? url : undefined;
      }
    }
    if (bold < 0) bold = 0;
    if (italic < 0) italic = 0;
  }
  pushText(stripped.slice(last));
  flush();
  return blocks;
}

/** Plain-text bodies: paragraphs on blank lines, `>` marks the quoted thread. */
function parsePlain(text: string): ParsedEmail {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // "On <date>, <someone> wrote:" is the other convention, and it introduces
  // everything after it rather than marking each line.
  let cut = lines.findIndex((l) => /^\s*>/.test(l) || /^\s*On .+ wrote:\s*$/.test(l));
  if (cut === -1) cut = lines.length;

  const toBlocks = (ls: string[], kind: Block["kind"]): Block[] =>
    ls
      .join("\n")
      .split(/\n\s*\n/)
      .map((para) => para.replace(/^\s*>+ ?/gm, "").trim())
      .filter(Boolean)
      .map((para) => ({ kind, spans: [{ text: para }] }));

  return {
    body: toBlocks(lines.slice(0, cut), "p"),
    quoted: toBlocks(lines.slice(cut), "quote"),
  };
}

/**
 * Parse an email body for display.
 *
 * `html` wins when present — it's what the sender actually composed. The plain
 * text is the fallback, and for a message that only ever had text it's not a
 * degradation at all.
 */
export function parseEmail(html: string | null | undefined, text: string): ParsedEmail {
  if (html && html.trim()) {
    const [main, quoted] = splitQuoted(html);
    return { body: parseFragment(main), quoted: parseFragment(quoted, true) };
  }
  return parsePlain(text ?? "");
}

/** Roughly how many lines this will occupy, for deciding whether to collapse. */
export function estimateLines(blocks: Block[], charsPerLine = 38): number {
  return blocks.reduce((n, b) => {
    const chars = b.spans.reduce((s, x) => s + x.text.length, 0);
    return n + Math.max(1, Math.ceil(chars / charsPerLine));
  }, 0);
}
