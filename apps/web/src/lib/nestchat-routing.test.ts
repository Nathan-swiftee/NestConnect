import { describe, expect, it } from "vitest";
import {
  DEFAULT_NESTCHAT_ROUTING,
  fillVisitorName,
  toPublicRouting,
  type NestChatRouting,
} from "@ding/schemas";

const routing = (over: Partial<NestChatRouting> = {}): NestChatRouting => ({
  ...DEFAULT_NESTCHAT_ROUTING,
  enabled: true,
  options: [
    { id: "opt_sales", label: "Sales", teamId: "team_sales", icon: "💷" },
    { id: "opt_billing", label: "Billing", description: "Invoices", teamId: "team_billing" },
  ],
  ...over,
});

describe("toPublicRouting", () => {
  it("never sends a team id to the visitor", () => {
    const out = toPublicRouting(routing(), ["team_sales", "team_billing"]);
    expect(out?.options).toEqual([
      { id: "opt_sales", label: "Sales", description: undefined, icon: "💷" },
      { id: "opt_billing", label: "Billing", description: "Invoices", icon: undefined },
    ]);
    for (const o of out?.options ?? []) expect(o).not.toHaveProperty("teamId");
  });

  it("drops an option whose team the channel no longer routes to", () => {
    // Otherwise a visitor picks "Billing", is told they've reached billing, and
    // lands in the default queue.
    const out = toPublicRouting(routing(), ["team_sales"]);
    expect(out?.options.map((o) => o.id)).toEqual(["opt_sales"]);
  });

  it("returns nothing when the menu is off", () => {
    expect(toPublicRouting(routing({ enabled: false }), ["team_sales"])).toBeUndefined();
  });

  it("returns nothing when the menu is empty", () => {
    expect(toPublicRouting(routing({ options: [] }), ["team_sales"])).toBeUndefined();
  });

  it("returns nothing when every option has gone stale", () => {
    expect(toPublicRouting(routing(), ["team_support"])).toBeUndefined();
  });

  it("carries the question and whether it must be answered", () => {
    const out = toPublicRouting(routing({ prompt: "What's it about?", required: false }), [
      "team_sales",
      "team_billing",
    ]);
    expect(out?.prompt).toBe("What's it about?");
    expect(out?.required).toBe(false);
  });
});

describe("fillVisitorName", () => {
  it("uses the first name only", () => {
    expect(fillVisitorName("Hi {name} 👋", "Sam Whitfield")).toBe("Hi Sam 👋");
  });

  it("leaves the sentence readable when there is no name", () => {
    // The token goes and the space it left goes with it — "Hi  👋" is the tell
    // that a greeting was written for somebody who never introduced themselves.
    expect(fillVisitorName("Hi {name} 👋", undefined)).toBe("Hi 👋");
    expect(fillVisitorName("Hi {name} 👋", "   ")).toBe("Hi 👋");
  });

  it("leaves a greeting with no token alone", () => {
    expect(fillVisitorName("How can we help?", "Sam")).toBe("How can we help?");
    expect(fillVisitorName("How can we help?", undefined)).toBe("How can we help?");
  });

  it("fills every occurrence", () => {
    expect(fillVisitorName("Hi {name}. Still there, {name}?", "Sam")).toBe(
      "Hi Sam. Still there, Sam?",
    );
  });
});
