import type { Attachment } from "@ding/schemas";

/**
 * Can this attachment be shown in the app, and as what?
 *
 * Its own module because the decision is entirely about strings and limits, and
 * getting it wrong is invisible: guess "text" for a zip and the agent gets a
 * screen of mojibake, guess "none" for a PDF and they're back to the share
 * sheet the app was supposed to replace. Importing anything under `components/`
 * reaches the theme and then AsyncStorage, so the rules live out here where a
 * test can run them. Same split as `email-fit.ts` and `templates.ts`.
 *
 * The filename matters as much as the MIME type, and often more. WhatsApp and
 * a good many mail clients label attachments `application/octet-stream`
 * regardless of what they are, so a rule that trusted the MIME alone would
 * decline to preview most of the PDFs that actually arrive.
 */
export type PreviewKind = "pdf" | "text" | "none";

/**
 * Caps, in bytes.
 *
 * A PDF is handed to the WebView as base64, which costs about 4/3 of the file
 * in a JS string and again in the page — 20MB is roughly where a mid-range
 * Android phone starts killing the tab instead of rendering. Text is capped far
 * lower because it is laid out as a single run: a 50MB log would not be
 * unreadable, it would be unscrollable.
 */
export const PREVIEW_LIMITS: Record<Exclude<PreviewKind, "none">, number> = {
  pdf: 20 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

/** Extensions that are plain text whatever the MIME says. */
const TEXT_EXTENSIONS = new Set([
  "txt", "text", "log", "csv", "tsv", "md", "markdown", "json", "xml", "yml", "yaml",
  "html", "htm", "css", "js", "mjs", "ts", "tsx", "jsx", "sql", "sh", "ini", "conf",
  "env", "toml", "srt", "vtt", "eml",
]);

/** The bit after the last dot, lower-cased. Empty when there isn't one. */
function extensionOf(filename?: string): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // `>0` not `>=0`: a leading dot is a hidden file, not an extension.
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The MIME without its parameters — `text/plain; charset=utf-8` → `text/plain`. */
function baseMime(mime?: string): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * What the app can render for this attachment, ignoring size.
 *
 * Kept separate from `previewFor` so the size rule can be stated once and the
 * "too big to preview" case can say so, rather than being indistinguishable
 * from "we can't read this kind of file at all".
 */
export function previewKind(att: Pick<Attachment, "mime" | "filename">): PreviewKind {
  const mime = baseMime(att.mime);
  const ext = extensionOf(att.filename);

  if (mime === "application/pdf" || mime === "application/x-pdf" || ext === "pdf") return "pdf";

  if (mime.startsWith("text/")) return "text";
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-yaml" ||
    mime === "application/yaml"
  ) {
    return "text";
  }
  // Only fall back to the extension when the MIME says nothing useful. A file
  // genuinely labelled `application/zip` named "notes.txt" is a zip.
  if ((!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") && TEXT_EXTENSIONS.has(ext)) {
    return "text";
  }
  return "none";
}

/** Why a file isn't being previewed, when it isn't. */
export interface PreviewPlan {
  kind: PreviewKind;
  /** True when the type is supported but the file is over the cap. */
  tooBig: boolean;
}

/** The kind, with the size rule applied. */
export function previewFor(att: Pick<Attachment, "mime" | "filename" | "size">): PreviewPlan {
  const kind = previewKind(att);
  if (kind === "none") return { kind, tooBig: false };
  const limit = PREVIEW_LIMITS[kind];
  // A missing or zero size is treated as previewable: refusing to open a file
  // because its length wasn't reported is worse than trying and failing.
  if (att.size && att.size > limit) return { kind: "none", tooBig: true };
  return { kind, tooBig: false };
}
