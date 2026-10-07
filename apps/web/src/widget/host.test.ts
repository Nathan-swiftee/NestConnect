import { describe, expect, it } from "vitest";
import { hostWillSpeak, readHostMessage, sameIdentity, sessionInputFor } from "./host";

describe("what the page says about who is signed in", () => {
  it("is only waited for when the loader said it would speak", () => {
    expect(hostWillSpeak("?key=nc_1&hs=1")).toBe(true);
    // The inline iframe embed and older loaders never answer; waiting for them
    // would hold every chat back by the whole timeout.
    expect(hostWillSpeak("?key=nc_1")).toBe(false);
  });

  it("reads our message and ignores everyone else's", () => {
    expect(readHostMessage({ type: "something-else", user: { id: "1" } })).toBeUndefined();
    expect(readHostMessage("nestchat:user")).toBeUndefined();
    expect(
      readHostMessage({
        type: "nestchat:user",
        user: { id: " 42 ", hash: "abc", name: "Marta", email: "marta@example.com", extra: "x" },
        fields: { order_id: "DG-1", empty: "  ", count: 3 },
      }),
    ).toEqual({
      user: { id: "42", hash: "abc", name: "Marta", email: "marta@example.com", phone: undefined },
      fields: { order_id: "DG-1" },
    });
  });

  it("treats a user with no id as nobody", () => {
    expect(readHostMessage({ type: "nestchat:user", user: { name: "Marta" } })?.user).toBeNull();
  });

  it("opens a signed-in session with the signature and details", () => {
    const who = readHostMessage({
      type: "nestchat:user",
      user: { id: "42", hash: "abc", name: "Marta", email: "marta@example.com" },
      fields: { order_id: "DG-1" },
    })!;
    expect(sessionInputFor(who, "browser123")).toEqual({
      visitorId: "browser123",
      externalId: "42",
      userHash: "abc",
      name: "Marta",
      email: "marta@example.com",
      fields: { order_id: "DG-1" },
    });
  });

  it("sends a visitor's page fields but never an email without a user", () => {
    const who = readHostMessage({ type: "nestchat:user", user: null, fields: { order_id: "DG-1" } })!;
    expect(sessionInputFor(who, "browser123")).toEqual({ visitorId: "browser123", fields: { order_id: "DG-1" } });
    expect(sessionInputFor(null, undefined)).toEqual({ visitorId: undefined });
  });

  it("only starts over when the person changes", () => {
    const a = readHostMessage({ type: "nestchat:user", user: { id: "1", name: "A" } })!;
    const aAgain = readHostMessage({ type: "nestchat:user", user: { id: "1", name: "A B" } })!;
    const b = readHostMessage({ type: "nestchat:user", user: { id: "2" } })!;
    const out = readHostMessage({ type: "nestchat:user", user: null })!;
    expect(sameIdentity(a, aAgain)).toBe(true);
    expect(sameIdentity(a, b)).toBe(false);
    expect(sameIdentity(a, out)).toBe(false);
    expect(sameIdentity(null, out)).toBe(true);
  });
});
