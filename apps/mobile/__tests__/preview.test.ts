import { PREVIEW_LIMITS, previewFor, previewKind } from "../src/preview";

/**
 * Which attachments the app will open, and as what.
 *
 * Worth pinning because both failure modes are quiet. Call a zip "text" and the
 * agent gets a screenful of mojibake instead of a share sheet; call a PDF
 * "none" and they are back to exporting an invoice to read it, which is the
 * thing this replaced.
 *
 * The awkward cases are all real ones off this stack: WhatsApp labels almost
 * every document `application/octet-stream`, mail servers append charsets, and
 * plenty of senders get the case wrong.
 */
const f = (mime: string, filename: string, size = 1000) => ({ mime, filename, size });

describe("previewKind", () => {
  it("reads a PDF from its MIME type", () => {
    expect(previewKind(f("application/pdf", "invoice.pdf"))).toBe("pdf");
    expect(previewKind(f("application/x-pdf", "invoice.pdf"))).toBe("pdf");
  });

  it("reads a PDF from the filename when the MIME is the usual lie", () => {
    // This is the common case, not an edge one: WhatsApp sends documents as
    // octet-stream, so trusting the MIME alone would decline most real PDFs.
    expect(previewKind(f("application/octet-stream", "Invoice #4471.pdf"))).toBe("pdf");
    expect(previewKind(f("", "statement.PDF"))).toBe("pdf");
  });

  it("ignores MIME parameters", () => {
    expect(previewKind(f("text/plain; charset=utf-8", "notes.txt"))).toBe("text");
    expect(previewKind(f("APPLICATION/PDF", "a.pdf"))).toBe("pdf");
  });

  it("treats the text family as text", () => {
    for (const m of ["text/plain", "text/csv", "text/html", "application/json", "application/xml"]) {
      expect(previewKind(f(m, "file"))).toBe("text");
    }
  });

  it("falls back to the extension only when the MIME says nothing", () => {
    expect(previewKind(f("application/octet-stream", "orders.csv"))).toBe("text");
    // A real declared type wins over a misleading name: this is a zip.
    expect(previewKind(f("application/zip", "notes.txt"))).toBe("none");
  });

  it("declines what it genuinely cannot render", () => {
    for (const [m, n] of [
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "brief.docx"],
      ["application/vnd.ms-excel", "sheet.xls"],
      ["application/zip", "photos.zip"],
      ["application/octet-stream", "backup.bin"],
    ]) {
      expect(previewKind(f(m, n))).toBe("none");
    }
  });

  it("does not mistake a dotfile for an extension", () => {
    expect(previewKind(f("application/octet-stream", ".env"))).toBe("none");
  });

  it("uses the last extension, and ignores directories in the name", () => {
    expect(previewKind(f("application/octet-stream", "archive.pdf.zip"))).toBe("none");
    expect(previewKind(f("application/octet-stream", "some/path/report.pdf"))).toBe("pdf");
  });
});

describe("previewFor", () => {
  it("passes a normal file straight through", () => {
    expect(previewFor(f("application/pdf", "a.pdf", 500_000))).toEqual({ kind: "pdf", tooBig: false });
  });

  it("refuses a file over the cap, and says that is why", () => {
    const huge = f("application/pdf", "a.pdf", PREVIEW_LIMITS.pdf + 1);
    expect(previewFor(huge)).toEqual({ kind: "none", tooBig: true });
  });

  it("allows a file exactly on the cap", () => {
    expect(previewFor(f("application/pdf", "a.pdf", PREVIEW_LIMITS.pdf)).kind).toBe("pdf");
  });

  it("caps text far lower than PDF — a long log is unscrollable, not just slow", () => {
    expect(PREVIEW_LIMITS.text).toBeLessThan(PREVIEW_LIMITS.pdf);
    expect(previewFor(f("text/plain", "big.log", PREVIEW_LIMITS.text + 1)).tooBig).toBe(true);
  });

  it("tries anyway when the size wasn't reported", () => {
    // Refusing to open a file because its length was missing from the webhook
    // is worse than opening it and failing honestly.
    expect(previewFor(f("application/pdf", "a.pdf", 0)).kind).toBe("pdf");
  });

  it("never reports tooBig for a type it couldn't render anyway", () => {
    expect(previewFor(f("application/zip", "x.zip", 999_999_999))).toEqual({ kind: "none", tooBig: false });
  });
});
