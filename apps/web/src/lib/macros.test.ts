import { describe, expect, it } from "vitest";
import {
  createMacroInputSchema,
  MACRO_PREVIEW_FILL,
  macroFitsTeams,
  macroQueryAt,
  resolveTemplateDefault,
  searchMacros,
} from "@ding/schemas";

/**
 * Macros in the composer: which ones a chat is offered, what "/…" finds, and
 * what lands in the reply box.
 */
const m = (name: string, shortcut: string | null, body: string, teamIds: string[] = []) => ({ name, shortcut, body, teamIds });
const all = [
  m("Delivery delayed", "delayed", "Sorry, your delivery is late."),
  m("Opening hours", "hours", "We're open 9–5.", ["team_support"]),
  m("Pricing", null, "Our price list is attached.", ["team_sales"]),
  m("Holiday delays", "holiday", "Over the holidays deliveries take longer."),
];

describe("which macros a conversation is offered", () => {
  it("one with no teams belongs to every team", () => {
    expect(macroFitsTeams(all[0]!, ["team_sales"])).toBe(true);
    expect(macroFitsTeams(all[0]!, [])).toBe(true);
  });
  it("one with teams only to those", () => {
    expect(macroFitsTeams(all[1]!, ["team_support"])).toBe(true);
    expect(macroFitsTeams(all[1]!, ["team_sales"])).toBe(false);
    expect(macroFitsTeams(all[1]!, ["team_sales", "team_support"])).toBe(true);
  });
});

describe("finding one", () => {
  it("lists everything by name with nothing typed", () => {
    expect(searchMacros(all, "").map((x) => x.name)).toEqual(["Delivery delayed", "Holiday delays", "Opening hours", "Pricing"]);
  });
  it("puts a shortcut match before a name or text match", () => {
    // "delayed" starts with it; "Holiday delays" only contains it.
    expect(searchMacros(all, "del").map((x) => x.name)).toEqual(["Delivery delayed", "Holiday delays"]);
  });
  it("ignores the slash and case", () => {
    expect(searchMacros(all, "/HOURS")[0]!.name).toBe("Opening hours");
  });
  it("searches the text last", () => {
    expect(searchMacros(all, "price").map((x) => x.name)).toEqual(["Pricing"]);
  });
  it("finds nothing for nonsense", () => {
    expect(searchMacros(all, "qqq")).toEqual([]);
  });
});

describe("the “/” trigger", () => {
  it("opens at the start of the message or after a space", () => {
    expect(macroQueryAt("/", 1)).toEqual({ start: 0, query: "" });
    expect(macroQueryAt("Thanks! /del", 12)).toEqual({ start: 8, query: "del" });
  });
  it("only looks behind the caret", () => {
    expect(macroQueryAt("/del and more", 4)).toEqual({ start: 0, query: "del" });
  });
  it("stays shut inside links, dates and and/or", () => {
    expect(macroQueryAt("see https://x.co/", 17)).toBeNull();
    expect(macroQueryAt("on 12/10", 8)).toBeNull();
    expect(macroQueryAt("and/or", 6)).toBeNull();
  });
  it("closes once the word ends", () => {
    expect(macroQueryAt("/del ", 5)).toBeNull();
  });
});

describe("saving one", () => {
  it("tidies the shortcut", () => {
    expect(createMacroInputSchema.parse({ name: "A", body: "b", shortcut: " /Late-Delivery " }).shortcut).toBe("late-delivery");
  });
  it("refuses a shortcut you couldn't type after a slash", () => {
    expect(createMacroInputSchema.safeParse({ name: "A", body: "b", shortcut: "late delivery" }).success).toBe(false);
    expect(createMacroInputSchema.safeParse({ name: "A", body: "b", shortcut: "-late" }).success).toBe(false);
  });
  it("defaults to every team", () => {
    expect(createMacroInputSchema.parse({ name: "A", body: "b" }).teamIds).toEqual([]);
  });
});

describe("what goes in the reply box", () => {
  it("fills placeholders for the chat", () => {
    const body = "Hi {{contact.first_name}}, it's {{agent.first_name}} from {{channel.name}}.";
    expect(resolveTemplateDefault(body, MACRO_PREVIEW_FILL)).toBe("Hi Marta, it's Nathan from Swiftee Support.");
  });
  it("leaves a gap rather than a placeholder when a fact is missing", () => {
    expect(resolveTemplateDefault("Hi {{contact.company}} team", {})).toBe("Hi  team");
  });
});
