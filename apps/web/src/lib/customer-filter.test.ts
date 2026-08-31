import { describe, expect, it } from "vitest";
import type { Contact } from "@ding/schemas";
import {
  EMPTY_FILTER,
  filterCustomers,
  isFiltered,
  reachableChannels,
  tagCounts,
} from "./customer-filter";

const c = (over: Partial<Contact> & { displayName: string }): Contact =>
  ({ id: over.displayName, orgId: "org", tags: [], ...over }) as Contact;

const people = [
  c({ displayName: "Acme Café", phone: "+44117", tags: ["VIP", "wholesale"] }),
  c({ displayName: "Bloom Florists", email: "hi@bloom.test", tags: ["wholesale"] }),
  c({ displayName: "Quay Bakery", phone: "+44118", email: "q@quay.test", tags: ["vip"] }),
  c({ displayName: "Tide & Co.", company: "Tide Ltd" }),
  c({ displayName: "Old Account", email: "old@x.test", blocked: true, tags: ["wholesale"] }),
];

describe("reachableChannels", () => {
  it("reads a number as WhatsApp and an address as email", () => {
    expect(reachableChannels({ phone: "+44117" })).toEqual(["whatsapp"]);
    expect(reachableChannels({ email: "a@b.c" })).toEqual(["email"]);
    expect(reachableChannels({ phone: "+44117", email: "a@b.c" })).toEqual(["whatsapp", "email"]);
  });

  it("returns nothing for a customer with neither", () => {
    expect(reachableChannels({})).toEqual([]);
  });
});

describe("filterCustomers", () => {
  it("hides blocked customers unless asked for", () => {
    expect(filterCustomers(people, EMPTY_FILTER).map((p) => p.displayName)).not.toContain("Old Account");
    expect(
      filterCustomers(people, { ...EMPTY_FILTER, showBlocked: true }).map((p) => p.displayName),
    ).toContain("Old Account");
  });

  it("searches name, company, number, address and tags", () => {
    const names = (q: string) => filterCustomers(people, { ...EMPTY_FILTER, query: q }).map((p) => p.displayName);
    expect(names("acme")).toEqual(["Acme Café"]);
    expect(names("tide ltd")).toEqual(["Tide & Co."]);
    expect(names("quay.test")).toEqual(["Quay Bakery"]);
    // Searching a tag still works without opening the tag menu.
    expect(names("wholesale").sort()).toEqual(["Acme Café", "Bloom Florists"]);
  });

  it("narrows as tags are added — two tags means both", () => {
    const one = filterCustomers(people, { ...EMPTY_FILTER, tags: ["wholesale"] });
    const two = filterCustomers(people, { ...EMPTY_FILTER, tags: ["wholesale", "VIP"] });
    expect(one.map((p) => p.displayName).sort()).toEqual(["Acme Café", "Bloom Florists"]);
    expect(two.map((p) => p.displayName)).toEqual(["Acme Café"]);
    expect(two.length).toBeLessThan(one.length);
  });

  it("matches tags whatever the casing", () => {
    // "VIP" typed by hand and "vip" from an import are the same label.
    expect(filterCustomers(people, { ...EMPTY_FILTER, tags: ["vip"] }).map((p) => p.displayName).sort()).toEqual([
      "Acme Café",
      "Quay Bakery",
    ]);
  });

  it("widens as channels are added — either, not both", () => {
    // The opposite rule to tags, and deliberately: most customers have a phone
    // or an address, so AND here would answer almost everything with nothing.
    const wa = filterCustomers(people, { ...EMPTY_FILTER, channels: ["whatsapp"] });
    const both = filterCustomers(people, { ...EMPTY_FILTER, channels: ["whatsapp", "email"] });
    expect(wa.map((p) => p.displayName).sort()).toEqual(["Acme Café", "Quay Bakery"]);
    expect(both.length).toBeGreaterThan(wa.length);
    // Tide has neither, so it never appears under a channel filter.
    expect(both.map((p) => p.displayName)).not.toContain("Tide & Co.");
  });

  it("combines search, tags and channels", () => {
    const out = filterCustomers(people, {
      ...EMPTY_FILTER,
      query: "a",
      tags: ["vip"],
      channels: ["whatsapp"],
    });
    expect(out.map((p) => p.displayName).sort()).toEqual(["Acme Café", "Quay Bakery"]);
  });

  it("keeps a blocked customer out even when they match everything else", () => {
    const out = filterCustomers(people, { ...EMPTY_FILTER, tags: ["wholesale"], channels: ["email"] });
    expect(out.map((p) => p.displayName)).toEqual(["Bloom Florists"]);
  });

  it("returns everything when nothing is set", () => {
    expect(filterCustomers(people, EMPTY_FILTER)).toHaveLength(4);
  });
});

describe("tagCounts", () => {
  it("counts each tag, commonest first, folding casing the way filtering does", () => {
    // "VIP" and "vip" are one label with two customers — listing them
    // separately and then having either match both is what reads as broken.
    // One "VIP" and one "vip" is a tie, so which spelling labels the group is
    // arbitrary — deterministic, but not a promise. The count is the claim.
    const counts = tagCounts(people);
    expect(counts.map((t) => t.count)).toEqual([3, 2]);
    expect(counts[0].tag).toBe("wholesale");
    expect(counts[1].tag.toLowerCase()).toBe("vip");
  });

  it("labels a folded tag with its commonest spelling", () => {
    const many = [
      c({ displayName: "A", tags: ["vip"] }),
      c({ displayName: "B", tags: ["vip"] }),
      c({ displayName: "C", tags: ["VIP"] }),
    ];
    // One import writing it in caps shouldn't relabel a directory that says "vip".
    expect(tagCounts(many)).toEqual([{ tag: "vip", count: 3 }]);
  });

  it("is empty when nobody is tagged", () => {
    expect(tagCounts([c({ displayName: "A" })])).toEqual([]);
  });
});

describe("isFiltered", () => {
  it("is false for an untouched filter, true once anything narrows", () => {
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, query: "  " })).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, query: "a" })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTER, tags: ["vip"] })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTER, channels: ["email"] })).toBe(true);
    // Showing blocked widens rather than narrows, so it isn't "filtered".
    expect(isFiltered({ ...EMPTY_FILTER, showBlocked: true })).toBe(false);
  });
});
