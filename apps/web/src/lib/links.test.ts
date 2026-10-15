import { describe, expect, it } from "vitest";
import { linkParts } from "@ding/schemas";

/**
 * Which words in a message turn into links. The cases are the ones people
 * actually type: addresses without "https://", a full stop after a link, a
 * bracket around one — and the near-misses that must stay plain text.
 */
const links = (text: string) => linkParts(text).filter((p) => p.href).map((p) => [p.text, p.href]);

describe("linkParts", () => {
  it("links full addresses, leaving the sentence's full stop outside", () => {
    expect(links("see https://swiftee.co.uk/track?id=1.")).toEqual([
      ["https://swiftee.co.uk/track?id=1", "https://swiftee.co.uk/track?id=1"],
    ]);
  });

  it("links www. and bare domains, adding https://", () => {
    expect(links("go to www.ding.co.uk now")).toEqual([["www.ding.co.uk", "https://www.ding.co.uk"]]);
    expect(links("our site swiftee.co.uk/track, thanks")).toEqual([["swiftee.co.uk/track", "https://swiftee.co.uk/track"]]);
    expect(links("Visit Amazon.com!")).toEqual([["Amazon.com", "https://Amazon.com"]]);
  });

  it("links email addresses as new mail", () => {
    expect(links("email nathan@swiftee.co.uk please")).toEqual([["nathan@swiftee.co.uk", "mailto:nathan@swiftee.co.uk"]]);
  });

  it("keeps a bracket the address opened, drops one around it", () => {
    expect(links("(at swiftee.co.uk)")).toEqual([["swiftee.co.uk", "https://swiftee.co.uk"]]);
    expect(links("https://en.wikipedia.org/wiki/Thing_(band)")).toEqual([
      ["https://en.wikipedia.org/wiki/Thing_(band)", "https://en.wikipedia.org/wiki/Thing_(band)"],
    ]);
  });

  it("leaves things that only look like addresses alone", () => {
    for (const text of ["e.g. this is v1.2 and file.txt", "price 3.50 at 10.30am", "hello.world", "@ding.com", "https://", "www."]) {
      expect(links(text), text).toEqual([]);
    }
  });

  it("never makes a script link", () => {
    expect(links("javascript:alert(1)")).toEqual([]);
    for (const p of linkParts("a https://x.co b www.y.com c z.io d e@f.com")) {
      if (p.href) expect(p.href).toMatch(/^(https?:|mailto:)/);
    }
  });

  it("gives back the original text exactly", () => {
    for (const text of ["see https://a.com/x. and www.b.co.uk, c.io!", "no links here", "", "multi\nline swiftee.co.uk\nend"]) {
      expect(linkParts(text).map((p) => p.text).join("")).toBe(text);
    }
  });
});
