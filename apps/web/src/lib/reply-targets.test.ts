import { describe, expect, it } from "vitest";
import { replyTargetsFor } from "@ding/schemas";

/**
 * These cover the composer's channel switcher for both clients: the web reads
 * this function and so does the phone, which is the point — the bug it fixes
 * existed twice because the rule was written out twice.
 */
const conv = (channel: string, contact: { phone?: string; email?: string } = {}) =>
  ({ channel, contact }) as Parameters<typeof replyTargetsFor>[0];

describe("replyTargetsFor", () => {
  it("offers the thread's own channel even when the contact has other addresses", () => {
    // The reported bug: a visitor who has given us an email is still someone
    // you answer in the chat window they are sitting in.
    expect(replyTargetsFor(conv("nestchat", { phone: "+447700900123", email: "a@b.com" }))).toEqual([
      "whatsapp",
      "email",
      "nestchat",
    ]);
  });

  it("still offers it when the contact has nothing else on file", () => {
    expect(replyTargetsFor(conv("nestchat"))).toEqual(["nestchat"]);
  });

  it("does not list the same channel twice", () => {
    expect(replyTargetsFor(conv("email", { email: "a@b.com" }))).toEqual(["email"]);
    expect(replyTargetsFor(conv("whatsapp", { phone: "+447700900123" }))).toEqual(["whatsapp"]);
  });

  it("lets an email thread be answered on WhatsApp when we hold a number", () => {
    expect(replyTargetsFor(conv("email", { phone: "+447700900123", email: "a@b.com" }))).toEqual([
      "whatsapp",
      "email",
    ]);
  });

  it("answers a group only in the group, whatever else we hold", () => {
    // A group message goes to the group. Replying to one person privately is a
    // different act, not a channel switch.
    expect(
      replyTargetsFor(conv("whatsapp_group", { phone: "+447700900123", email: "a@b.com" })),
    ).toEqual(["whatsapp_group"]);
  });

  it("ignores empty strings, which are not addresses", () => {
    expect(replyTargetsFor(conv("nestchat", { phone: "", email: "" }))).toEqual(["nestchat"]);
  });
});
