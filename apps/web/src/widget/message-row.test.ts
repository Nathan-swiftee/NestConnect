import { describe, expect, it } from "vitest";
import type { NestChatQuote } from "@ding/schemas";
import { collapse, describeQuote } from "./MessageRow";

describe("reaction pills", () => {
  it("counts one pill per emoji, not one per person", () => {
    const pills = collapse([
      { emoji: "👍", by: "visitor" },
      { emoji: "👍", by: "agent" },
      { emoji: "❤️", by: "agent" },
    ]);
    expect(pills).toEqual([
      { emoji: "👍", count: 2, ours: true },
      { emoji: "❤️", count: 1, ours: false },
    ]);
  });

  it("marks ours whichever order it arrived in", () => {
    // The highlight is what tells you a second tap will take it off, so it has
    // to survive an agent having reacted first.
    const [pill] = collapse([
      { emoji: "👍", by: "agent" },
      { emoji: "👍", by: "visitor" },
    ]);
    expect(pill).toEqual({ emoji: "👍", count: 2, ours: true });
  });

  it("has nothing to draw when nobody reacted", () => {
    expect(collapse([])).toEqual([]);
  });
});

describe("what a quote says", () => {
  const quote = (over: Partial<NestChatQuote>): NestChatQuote => ({
    id: "m1",
    from: "agent",
    preview: "",
    ...over,
  });

  it("uses the words when there were words", () => {
    expect(describeQuote(quote({ preview: "On its way" }))).toBe("On its way");
  });

  it("names what it was when there were none", () => {
    // "" under a reply reads as a broken quote rather than as a recording.
    expect(describeQuote(quote({ kind: "voice" }))).toBe("Voice message");
    expect(describeQuote(quote({ kind: "image" }))).toBe("Photo");
    expect(describeQuote(quote({ kind: "video" }))).toBe("Video");
  });

  it("still says something for a kind it has never heard of", () => {
    expect(describeQuote(quote({}))).toBe("Attachment");
  });
});
