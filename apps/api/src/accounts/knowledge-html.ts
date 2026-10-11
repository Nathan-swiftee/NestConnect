import sanitizeHtml from "sanitize-html";

/**
 * Rich text written in the knowledge editor (SOP instructions, customer notes),
 * cleaned once on the way in so every reader can render it as it is stored.
 *
 * The editor only produces structure — headings, lists, emphasis, links, quotes,
 * code — so that's all that's kept. No images, styles, scripts or event
 * attributes; links open in a new tab and can't reach back into the app.
 */
export function sanitizeKnowledgeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  const clean = sanitizeHtml(dirty, {
    allowedTags: [
      "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
      "blockquote", "code", "pre", "hr", "a",
    ],
    allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
      h1: "h2",
    },
  });
  // An editor left empty produces "<p></p>".
  return /^(\s|<p>(\s|<br\s*\/?>)*<\/p>)*$/i.test(clean) ? "" : clean.trim();
}

/** The words of a piece of knowledge HTML, for search and previews. */
export function knowledgeText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}
