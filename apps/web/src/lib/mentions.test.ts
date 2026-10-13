import { describe, expect, it } from "vitest";
import { mentionHandle, mentionLabel, mentionParts, mentionsToNames, namesToHandles, noteMentionCandidates } from "@ding/schemas";

/**
 * @-mentions: people see names, the server routes by handle. The note is
 * stored as "@nathan" and must read as "@Nathan A" everywhere it's shown.
 */
const team = [
  { name: "Nathan A", email: "nathan@swiftee.co.uk" },
  { name: "Sam", email: "sam@swiftee.co.uk" },
  { name: "Sam Lee", email: "slee@swiftee.co.uk" },
  { name: "Jo", email: "jo.one@swiftee.co.uk" },
  { name: "Jo", email: "jo.two@swiftee.co.uk" },
];

describe("writing a mention", () => {
  it("inserts the name", () => {
    expect(mentionLabel(team[0]!, team)).toBe("@Nathan A");
  });
  it("falls back to the handle when two people share a name", () => {
    expect(mentionLabel(team[3]!, team)).toBe("@jo.one");
  });
  it("sends the handle", () => {
    expect(namesToHandles("@Nathan A can you look?", team)).toBe("@nathan can you look?");
  });
  it("matches the longest name first", () => {
    expect(namesToHandles("@Sam Lee and @Sam, thanks", team)).toBe("@slee and @sam, thanks");
  });
  it("ignores case and stops at punctuation", () => {
    expect(namesToHandles("over to @nathan a.", team)).toBe("over to @nathan.");
  });
  it("leaves an email address alone", () => {
    expect(namesToHandles("write to a@Nathan A", team)).toBe("write to a@Nathan A");
  });
  it("leaves a handle typed by hand as it is", () => {
    expect(namesToHandles("cc @slee", team)).toBe("cc @slee");
  });
});

describe("reading a mention", () => {
  it("shows the name for a handle", () => {
    expect(mentionsToNames("@nathan can you look?", team)).toBe("@Nathan A can you look?");
  });
  it("keeps a full stop after it outside the mention", () => {
    expect(mentionParts("thanks @sam.", team)).toEqual([
      { text: "thanks ", mention: false },
      { text: "@Sam", mention: true },
      { text: ".", mention: false },
    ]);
  });
  it("shows an unknown handle as written", () => {
    expect(mentionsToNames("ask @ghost", team)).toBe("ask @ghost");
  });
  it("round-trips", () => {
    const typed = "@Nathan A and @Sam Lee — please check";
    expect(mentionsToNames(namesToHandles(typed, team), team)).toBe(typed);
  });
  it("the handle is the email's local part, lower-cased", () => {
    expect(mentionHandle({ email: "Nathan@Swiftee.co.uk" })).toBe("@nathan");
  });
});

describe("noteMentionCandidates", () => {
  const p = (name: string, teamIds: string[]) => ({ user: { name, email: `${name.toLowerCase()}@swiftee.co.uk` }, teamIds });
  const people = [p("Amara", ["sales"]), p("Ben", ["support"]), p("Cara", []), p("Dev", ["support", "sales"])];

  it("puts the people on the conversation's inbox first, then everyone else", () => {
    const { list, here } = noteMentionCandidates(people, ["support"], "");
    expect(list.map((u) => u.name)).toEqual(["Ben", "Dev", "Amara", "Cara"]);
    expect(here).toBe(2);
  });

  it("keeps that order while filtering", () => {
    const { list, here } = noteMentionCandidates(people, ["sales"], "a");
    expect(list.map((u) => u.name)).toEqual(["Amara", "Cara"]);
    expect(here).toBe(1);
  });

  it("is one list when the inbox has no teams", () => {
    const { list, here } = noteMentionCandidates(people, [], "");
    expect(list.map((u) => u.name)).toEqual(["Amara", "Ben", "Cara", "Dev"]);
    expect(here).toBe(0);
  });

  it("caps the list, counting only what's shown", () => {
    const { list, here } = noteMentionCandidates(people, ["support"], "", 1);
    expect(list.map((u) => u.name)).toEqual(["Ben"]);
    expect(here).toBe(1);
  });
});
