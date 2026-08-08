import sanitizeHtml from "sanitize-html";

/**
 * Server-side sanitisation for inbound (and outbound) email HTML. This is the
 * first of two defences — the second is the sandboxed iframe the web renders it
 * in (no scripts can run there). Here we:
 *   - allowlist safe formatting/layout tags + attributes, dropping <script>,
 *     <style>, <iframe>, <object>, <form>, event handlers and javascript: URLs;
 *   - force every link to open in a new tab with a safe rel;
 *   - block remote images by moving their src to data-blocked-src so the client
 *     can reveal them on demand (defeats tracking pixels by default).
 */

/** Cap pathological payloads so a giant email can't wedge the parser. */
const MAX_HTML = 512 * 1024;

const ALLOWED_TAGS = [
  "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "b", "strong", "i", "em", "u", "s", "strike", "del", "ins",
  "sub", "sup", "small", "mark", "abbr", "cite", "q", "big", "tt",
  "a", "img",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "figure", "figcaption", "center", "font", "address", "label", "time", "wbr",
];

const COMMON_ATTRS = [
  "style", "align", "valign", "dir", "title", "width", "height",
  "bgcolor", "color", "face", "size", "colspan", "rowspan",
  "border", "cellpadding", "cellspacing", "class", "nowrap",
];

export interface SanitizedHtml {
  html: string;
  /** How many remote images were blocked (drives the "Show images" prompt). */
  blockedImages: number;
}

/** Sanitise untrusted email HTML and block remote images by default. */
export function sanitizeEmailHtml(dirty: string | null | undefined): SanitizedHtml {
  const input = (dirty ?? "").slice(0, MAX_HTML);
  if (!input.trim()) return { html: "", blockedImages: 0 };

  let blockedImages = 0;
  const html = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": COMMON_ATTRS,
      a: ["href", "name", "target", "rel", "title", "style", "class"],
      img: ["src", "alt", "width", "height", "style", "class", "data-blocked-src"],
      font: ["color", "face", "size"],
      col: ["span", "width", "style"],
      table: ["width", "border", "cellpadding", "cellspacing", "bgcolor", "align", "style", "class"],
    },
    // Links may only use these; images additionally allow inline/attachment data.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    // Drop these tags *and* their text content outright.
    nonTextTags: ["script", "style", "textarea", "noscript", "title", "head"],
    transformTags: {
      a: (tagName, attribs) => {
        attribs.target = "_blank";
        attribs.rel = "noopener noreferrer nofollow";
        return { tagName, attribs };
      },
      img: (tagName, attribs) => {
        const src = attribs.src ?? "";
        // Inline (cid:/data:) images are safe to keep; remote ones are blocked
        // until the agent asks to see them.
        if (/^https?:\/\//i.test(src)) {
          blockedImages += 1;
          attribs["data-blocked-src"] = src;
          delete attribs.src;
        }
        return { tagName, attribs };
      },
    },
  });

  return { html: stripCssUrls(html), blockedImages };
}

/**
 * Remove `url(...)` from inline `style` attributes. A CSS background image
 * (`style="background:url(http://tracker/x.png)"`) would otherwise fetch on
 * render and defeat the <img>-level remote-image block, leaking the reader's IP.
 */
function stripCssUrls(html: string): string {
  return html.replace(
    /style="([^"]*)"/gi,
    (_m, css: string) => `style="${css.replace(/url\(\s*(['"]?)[^)]*\1\s*\)/gi, "none")}"`,
  );
}

/**
 * Sanitise the agent's OWN composed HTML before sending. Uses the same tag /
 * attribute allowlist and script/handler stripping as inbound, but keeps the
 * agent's remote images and doesn't force `nofollow` — those are inbound
 * anti-tracking behaviours that would wrongly break a legitimate outbound email
 * (a hosted signature logo, pasted image, or real marketing link).
 */
export function sanitizeOutboundHtml(dirty: string | null | undefined): string {
  const input = (dirty ?? "").slice(0, MAX_HTML);
  if (!input.trim()) return "";
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": COMMON_ATTRS,
      a: ["href", "name", "target", "rel", "title", "style", "class"],
      img: ["src", "alt", "width", "height", "style", "class"],
      font: ["color", "face", "size"],
      col: ["span", "width", "style"],
      table: ["width", "border", "cellpadding", "cellspacing", "bgcolor", "align", "style", "class"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    nonTextTags: ["script", "style", "textarea", "noscript", "title", "head"],
    transformTags: {
      a: (tagName, attribs) => {
        attribs.target = "_blank";
        attribs.rel = "noopener noreferrer";
        return { tagName, attribs };
      },
    },
  });
}

/** Minimal HTML-entity decode for the handful that appear in extracted text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

/**
 * Flatten HTML to readable plain text — for list previews and the plain-text
 * alternative part of an outbound multipart email. Block-level tags become line
 * breaks; everything else is stripped.
 */
export function htmlToText(html: string | null | undefined): string {
  return decodeEntities(
    (html ?? "")
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Escape plain text and wrap it as simple HTML (paragraphs + line breaks +
 *  auto-linked URLs) — the fallback when an email is sent without rich HTML. */
export function textToHtml(text: string | null | undefined): string {
  const escaped = (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`,
  );
  const paras = linked
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return paras || "<p></p>";
}
