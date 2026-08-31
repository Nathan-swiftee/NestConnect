/**
 * Reading a CSV the way spreadsheets actually write them.
 *
 * There is a temptation to `split(",")` and move on. It survives exactly one
 * test file and then meets a customer list from the real world: an address with
 * a comma in it, a company called `O"Neill & Sons`, a note field with a line
 * break inside it, a German Excel export delimited with semicolons because the
 * locale uses a comma for decimals, and a byte-order mark that turns the first
 * header into `﻿Name` so nothing matches it.
 *
 * All of those are one file each, and every one of them silently produces
 * *wrong data* rather than an error — customers imported with a column's worth
 * of their address in the name field. So this parses properly, and the parsing
 * is pure string-in/rows-out so it can be tested without a browser.
 */

/** What separated the fields. Sniffed, but overridable. */
export type Delimiter = "," | ";" | "\t";

const DELIMITERS: Delimiter[] = [",", ";", "\t"];

/**
 * Guess the delimiter from the header line.
 *
 * Counts candidates *outside* quotes on the first line and takes the commonest.
 * The first line is enough — it's the header, and a header with three semicolons
 * and no commas is not ambiguous. Ties go to comma, which is what "CSV" means
 * when nobody has said otherwise.
 */
export function sniffDelimiter(text: string): Delimiter {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Excel writes a UTF-8 BOM. Left in place it becomes part of the first header
 *  name, so `Name` stops matching and the whole first column goes unmapped. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a CSV into rows of raw strings.
 *
 * RFC-4180 quoting: a field may be wrapped in `"`, inside which the delimiter,
 * CR, LF and `""` (an escaped quote) are all literal. Line endings are accepted
 * in all three flavours because the three platforms disagree and a file that
 * came off a Mac in 2009 is still a file.
 *
 * Blank lines are dropped. A trailing newline — which every well-behaved writer
 * emits — would otherwise become a final row of one empty field, which reads
 * downstream as a customer with no name.
 */
export function parseCsv(text: string, delimiter: Delimiter = sniffDelimiter(text)): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A row of nothing but empty strings is a blank line, not a record.
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        // `""` inside a quoted field is one literal quote.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      // Only opens a quoted field at the start of one. A stray quote mid-field
      // (`5" pipe`) is data, and treating it as a delimiter would swallow the
      // rest of the file into one field.
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r") {
      // CRLF or a lone CR (classic Mac); either way the row ends here.
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
  }
  // Whatever is left after the last line ending, unless the file ended on one.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/** A parsed file split into its header row and its records. */
export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
}

/**
 * Parse and split off the header row.
 *
 * Header cells are trimmed here rather than at match time, because a trailing
 * space in `"Email "` is invisible in a spreadsheet and would otherwise be the
 * reason a column doesn't map.
 */
export function parseCsvTable(text: string, delimiter?: Delimiter): CsvTable {
  const d = delimiter ?? sniffDelimiter(text);
  const all = parseCsv(text, d);
  if (all.length === 0) return { headers: [], rows: [], delimiter: d };
  return { headers: all[0].map((h) => h.trim()), rows: all.slice(1), delimiter: d };
}
