import { contactPatch } from "../src/contact";

/**
 * The rule the form rests on: send what changed, and only what changed.
 *
 * This is worth pinning because both ways of getting it wrong are silent. Send
 * too much and a Save from a phone that has been in a pocket for an hour
 * overwrites whatever a colleague fixed on the web in the meantime — no error,
 * just the old value back. Send too little and clearing a wrong number does
 * nothing, which reads as the app ignoring you.
 */
const base = {
  displayName: "Northside Logistics",
  phone: "+44 113 555 0148",
  email: "accounts@northside.io",
};
const draftOf = (o: Partial<typeof base> = {}) => ({ ...base, ...o });

describe("contactPatch", () => {
  it("is empty when nothing was touched", () => {
    expect(contactPatch(base, draftOf())).toEqual({});
  });

  it("carries only the field that changed", () => {
    expect(contactPatch(base, draftOf({ phone: "+44 113 555 0199" }))).toEqual({
      phone: "+44 113 555 0199",
    });
  });

  it("trims, and treats a whitespace-only edit as no change", () => {
    expect(contactPatch(base, draftOf({ email: "  accounts@northside.io  " }))).toEqual({});
    expect(contactPatch(base, draftOf({ email: " ops@northside.io " }))).toEqual({
      email: "ops@northside.io",
    });
  });

  it("sends an empty string to clear a field that had a value", () => {
    // Deleting a wrong number is a real edit, so "" has to reach the server —
    // this is the case that a naive `if (value)` guard would swallow.
    expect(contactPatch(base, draftOf({ phone: "" }))).toEqual({ phone: "" });
  });

  it("leaves an untouched empty field out of the patch entirely", () => {
    // The schema makes these optional, not nullable — a customer with no
    // phone has no `phone` key at all rather than a null one.
    const sparse = {
      displayName: "Tide & Co.",
      phone: undefined,
      email: undefined,
    };
    expect(
      contactPatch(sparse, { displayName: "Tide & Co.", phone: "", email: "" }),
    ).toEqual({});
  });

  it("never sends an empty name — a customer must keep one", () => {
    expect(contactPatch(base, draftOf({ displayName: "   " }))).toEqual({});
  });

  it("handles a contact whose optional fields are absent rather than null", () => {
    const bare = { displayName: "Acme Café" };
    expect(contactPatch(bare, { displayName: "Acme Café", phone: "", email: "" })).toEqual({});
    expect(
      contactPatch(bare, { displayName: "Acme Café", phone: "0117", email: "" }),
    ).toEqual({ phone: "0117" });
  });
});
