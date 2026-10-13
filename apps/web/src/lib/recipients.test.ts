import { describe, expect, it } from "vitest";
import { isEmailAddress, parseAddressList, recipientSuggestions } from "@ding/schemas";

/** Forward and Cc/Bcc: customers suggested as you type, any address accepted. */
const people = [
  { id: "1", displayName: "Marta Kowalska", email: "marta@northside.io", company: "Northside Logistics" },
  { id: "2", displayName: "Mark Doyle", email: "mark@acme.co", company: "Acme" },
  { id: "3", displayName: "Amara Obi", email: "AMARA@tide.co", company: "Tide & Co" },
  { id: "4", displayName: "No Email", email: null },
  { id: "5", displayName: "Marty Blocked", email: "marty@spam.io", blocked: true },
];

describe("suggestions", () => {
  it("nothing until something is typed", () => {
    expect(recipientSuggestions(people, "")).toEqual([]);
  });
  it("matches name and email prefixes first, then anything containing it", () => {
    // Mark and Marta start with it; Amara only contains it.
    expect(recipientSuggestions(people, "mar").map((c) => c.id)).toEqual(["2", "1", "3"]);
  });
  it("finds a later word in the name, and the company", () => {
    expect(recipientSuggestions(people, "kowal").map((c) => c.id)).toEqual(["1"]);
    expect(recipientSuggestions(people, "tide").map((c) => c.id)).toEqual(["3"]);
  });
  it("only customers with an email, never blocked ones", () => {
    expect(recipientSuggestions(people, "no email")).toEqual([]);
    expect(recipientSuggestions(people, "marty")).toEqual([]);
  });
  it("leaves out anyone already added, whatever the case", () => {
    expect(recipientSuggestions(people, "a", ["amara@tide.co"]).some((c) => c.id === "3")).toBe(false);
  });
  it("caps the list", () => {
    expect(recipientSuggestions(people, "a", [], 2)).toHaveLength(2);
  });
});

describe("typed addresses", () => {
  it("splits on commas, semicolons and spaces, lower-cased and once each", () => {
    expect(parseAddressList("A@x.com, b@y.com; a@x.com  c@z.co")).toEqual(["a@x.com", "b@y.com", "c@z.co"]);
  });
  it("takes the address out of a pasted name <address>", () => {
    expect(parseAddressList("Marta <Marta@northside.io>, mailto:ops@x.com")).toEqual(["marta@northside.io", "ops@x.com"]);
  });
  it("knows a half-typed address", () => {
    expect(isEmailAddress("marta@northside.io")).toBe(true);
    expect(isEmailAddress("marta@northside")).toBe(false);
    expect(isEmailAddress("marta")).toBe(false);
    expect(isEmailAddress("a b@x.com")).toBe(false);
  });
});
