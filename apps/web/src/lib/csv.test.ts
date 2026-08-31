import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvTable, sniffDelimiter } from "./csv";

/**
 * Every case here is a file a spreadsheet actually produces, and every one of
 * them fails *silently* under `split(",")` — not with an error, but with a
 * customer whose name contains half their address. That is the reason this
 * parser exists rather than a one-liner.
 */
describe("parseCsv", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps a comma that lives inside a quoted field", () => {
    expect(parseCsv('name,address\n"Smith, John","12 High St, Bristol"')).toEqual([
      ["name", "address"],
      ["Smith, John", "12 High St, Bristol"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([["note"], ["line one\nline two"]]);
  });

  it("treats a stray quote mid-field as data, not as a delimiter", () => {
    // `5" pipe` is a real product name. Opening a quoted field here would
    // swallow the rest of the file into one cell.
    expect(parseCsv('item\n5" pipe')).toEqual([["item"], ['5" pipe']]);
  });

  it("handles CRLF and lone CR line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("drops the trailing newline rather than inventing an empty record", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("drops blank lines in the middle of a file", () => {
    expect(parseCsv("a\n1\n\n2\n")).toEqual([["a"], ["1"], ["2"]]);
  });

  it("keeps genuinely empty cells inside a populated row", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  it("strips Excel's byte-order mark off the first header", () => {
    // Left in, the first header becomes "﻿Name" and never matches anything.
    const { headers } = parseCsvTable("﻿Name,Email\nA,a@b.c");
    expect(headers).toEqual(["Name", "Email"]);
  });
});

describe("sniffDelimiter", () => {
  it("defaults to a comma", () => {
    expect(sniffDelimiter("name,email\nA,a@b.c")).toBe(",");
  });

  it("finds the semicolons a European Excel export uses", () => {
    expect(sniffDelimiter("name;email;phone\nA;a@b.c;123")).toBe(";");
  });

  it("finds tabs", () => {
    expect(sniffDelimiter("name\temail\nA\ta@b.c")).toBe("\t");
  });

  it("ignores delimiters that only appear inside quotes", () => {
    // The header has one real semicolon and two commas, but both commas are
    // inside a quoted heading — so this is semicolon-delimited.
    expect(sniffDelimiter('"Name, first, then last";Email')).toBe(";");
  });

  it("parses a semicolon file end to end", () => {
    const { headers, rows } = parseCsvTable("Name;Email\nAcme;a@b.c");
    expect(headers).toEqual(["Name", "Email"]);
    expect(rows).toEqual([["Acme", "a@b.c"]]);
  });
});

describe("parseCsvTable", () => {
  it("trims header whitespace, which is invisible in a spreadsheet", () => {
    expect(parseCsvTable("  Name , Email \nA,a@b.c").headers).toEqual(["Name", "Email"]);
  });

  it("survives an empty file", () => {
    expect(parseCsvTable("")).toEqual({ headers: [], rows: [], delimiter: "," });
  });

  it("survives a header with no records", () => {
    const t = parseCsvTable("Name,Email\n");
    expect(t.headers).toEqual(["Name", "Email"]);
    expect(t.rows).toEqual([]);
  });
});
