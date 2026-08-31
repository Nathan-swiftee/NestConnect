import { describe, expect, it } from "vitest";
import { matchColumns, rowsToContacts, splitTags } from "./import-mapping";

/**
 * The header names here are taken from what CRMs and spreadsheets actually
 * export. The important ones are the traps: headers that a first-match scan
 * gets wrong in a way nobody notices until the directory is full of customers
 * named after their employer.
 */
describe("matchColumns", () => {
  it("maps the obvious headers", () => {
    expect(matchColumns(["Name", "Company", "Phone", "Email"])).toEqual({
      displayName: 0,
      company: 1,
      phone: 2,
      email: 3,
    });
  });

  it("does NOT read 'Company Name' as the customer's name", () => {
    // The trap. "Company Name" contains "name", so first-match scanning imports
    // every customer under their employer's name.
    const m = matchColumns(["Company Name", "Contact Name", "Email"]);
    expect(m.company).toBe(0);
    expect(m.displayName).toBe(1);
  });

  it("prefers an exact 'Name' over a longer header that merely contains it", () => {
    const m = matchColumns(["Account Name", "Name"]);
    expect(m.displayName).toBe(1);
    expect(m.company).toBe(0);
  });

  it("recognises the usual synonyms", () => {
    expect(matchColumns(["Client", "Organisation", "Mobile", "E-mail Address"])).toEqual({
      displayName: 0,
      company: 1,
      phone: 2,
      email: 3,
    });
  });

  it("copes with punctuation and casing", () => {
    expect(matchColumns(["FULL_NAME", "e-mail", "Mobile No."])).toMatchObject({
      displayName: 0,
      email: 1,
      phone: 2,
    });
  });

  it("finds a split name and drops the ambiguous whole one", () => {
    const m = matchColumns(["First Name", "Last Name", "Name", "Email"]);
    expect(m.firstName).toBe(0);
    expect(m.lastName).toBe(1);
    expect(m.displayName).toBeUndefined();
  });

  it("never maps two fields to the same column", () => {
    const m = matchColumns(["Contact", "Email"]);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it("leaves unknown columns unmapped rather than guessing", () => {
    const m = matchColumns(["Invoice Ref", "Balance", "Email"]);
    expect(m.email).toBe(2);
    expect(m.displayName).toBeUndefined();
    expect(m.company).toBeUndefined();
  });

  it("finds a tags column", () => {
    expect(matchColumns(["Name", "Email", "Tags"]).tags).toBe(2);
    expect(matchColumns(["Name", "Email", "Segment"]).tags).toBe(2);
  });

  it("handles a file with no headers at all", () => {
    expect(matchColumns([])).toEqual({});
  });
});

describe("splitTags", () => {
  it("accepts the separators people use", () => {
    expect(splitTags("vip, wholesale")).toEqual(["vip", "wholesale"]);
    expect(splitTags("vip; wholesale")).toEqual(["vip", "wholesale"]);
    expect(splitTags("vip|wholesale")).toEqual(["vip", "wholesale"]);
  });

  it("drops empties left by trailing separators", () => {
    expect(splitTags("vip,,")).toEqual(["vip"]);
    expect(splitTags("   ")).toEqual([]);
  });
});

describe("rowsToContacts", () => {
  const map = { displayName: 0, company: 1, phone: 2, email: 3 };

  it("builds a contact, omitting blank fields rather than sending empty strings", () => {
    const [r] = rowsToContacts([["Acme Café", "", "", "a@b.c"]], map);
    expect(r.contact).toEqual({ displayName: "Acme Café", email: "a@b.c" });
  });

  it("joins a split name", () => {
    const [r] = rowsToContacts([["Jo", "Bloggs", "0117"]], { firstName: 0, lastName: 1, phone: 2 });
    expect(r.contact?.displayName).toBe("Jo Bloggs");
  });

  it("falls back to the email's local part when there is no name column", () => {
    const [r] = rowsToContacts([["j.smith@example.com"]], { email: 0 });
    expect(r.contact?.displayName).toBe("j.smith");
  });

  it("skips a row with no name and no email to fall back on", () => {
    const [r] = rowsToContacts([["", "", "0117", ""]], map);
    expect(r.contact).toBeNull();
    expect(r.problem).toBe("No name");
  });

  it("skips a row nobody could ever be messaged on", () => {
    // A contact with neither phone nor email can only ever be deleted.
    const [r] = rowsToContacts([["Acme", "Acme Ltd", "", ""]], map);
    expect(r.contact).toBeNull();
    expect(r.problem).toBe("No phone or email");
  });

  it("numbers rows as a spreadsheet does — the header is not row 1", () => {
    const rows = rowsToContacts([["A", "", "", "a@b.c"], ["B", "", "", "b@b.c"]], map);
    expect(rows.map((r) => r.line)).toEqual([1, 2]);
  });

  it("applies the bulk tags to every row", () => {
    const rows = rowsToContacts([["A", "", "", "a@b.c"], ["B", "", "", "b@b.c"]], map, ["import-jan"]);
    expect(rows.every((r) => r.contact?.tags?.includes("import-jan"))).toBe(true);
  });

  it("merges bulk tags with the file's own without duplicating", () => {
    const [r] = rowsToContacts([["A", "", "", "a@b.c", "vip,wholesale"]], { ...map, tags: 4 }, ["vip"]);
    expect(r.contact?.tags).toEqual(["vip", "wholesale"]);
  });

  it("trims cells — a stray space is not a different phone number", () => {
    const [r] = rowsToContacts([["  Acme  ", "", " 0117 ", ""]], map);
    expect(r.contact).toMatchObject({ displayName: "Acme", phone: "0117" });
  });

  it("tolerates a short row rather than throwing on a missing cell", () => {
    const [r] = rowsToContacts([["Acme"]], map);
    expect(r.problem).toBe("No phone or email");
  });
});
