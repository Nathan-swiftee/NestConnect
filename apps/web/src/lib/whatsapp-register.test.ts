import { describe, expect, it } from "vitest";
import {
  WHATSAPP_STATUS_LABEL,
  whatsAppCanRegister,
  whatsAppNumberStatusSchema,
  whatsAppRegisterInputSchema,
} from "@ding/schemas";

/**
 * The contract between the settings screen and the registration endpoint.
 *
 * The Graph behaviour is checked in tools/check-whatsapp-register.ts, against a
 * stubbed Meta. What is left — and what belongs here, where the UI's own tests
 * live — is the shape of the thing the browser sends and the words it puts on
 * screen for what comes back.
 */

describe("the two-step verification PIN", () => {
  it("takes exactly six digits", () => {
    expect(whatsAppRegisterInputSchema.safeParse({ pin: "123456" }).success).toBe(true);
  });

  it("rejects everything that isn't", () => {
    // Five and seven are the typos; the rest are the mix-ups. A spaced or
    // hyphenated PIN matters because Meta counts a rejection as one of the few
    // guesses it allows before locking the number out for a day — which is why
    // the field strips non-digits as you type rather than relying on this.
    for (const pin of ["12345", "1234567", "", "12 34 56", "123-456", "abcdef", "12345a", " 123456"]) {
      expect(whatsAppRegisterInputSchema.safeParse({ pin }).success, pin).toBe(false);
    }
  });

  it("explains itself in the words the field uses", () => {
    const result = whatsAppRegisterInputSchema.safeParse({ pin: "1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/exactly 6 digits/i);
    }
  });
});

describe("what the channel editor shows", () => {
  it("has a label for every status", () => {
    for (const status of whatsAppNumberStatusSchema.options) {
      expect(WHATSAPP_STATUS_LABEL[status], status).toBeTruthy();
    }
  });

  it("offers the Register button for the one status registering fixes", () => {
    // Not connected (nothing to do) and not the three failures — a PIN box in
    // front of a dead token or a banned number is a dead end dressed up as a
    // next step.
    const offered = whatsAppNumberStatusSchema.options.filter(whatsAppCanRegister);
    expect(offered).toEqual(["registration_required"]);
  });
});
