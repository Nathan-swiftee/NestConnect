import { describe, expect, it } from "vitest";
import {
  DEFAULT_NESTCHAT_PRECHAT,
  type NestChatPreChat,
  type NestChatPublicRouting,
} from "@ding/schemas";
import { gateFor, type PreChatInput } from "./prechat";

const EMPTY_FORM = { name: "", email: "", phone: "" };

function input(over: Partial<PreChatInput> = {}): PreChatInput {
  return {
    identified: false,
    chosen: false,
    hasThread: false,
    startDone: false,
    form: EMPTY_FORM,
    starting: false,
    ...over,
  };
}

/** The default form: name and email, both required. */
const form = (over: Partial<NestChatPreChat> = {}): NestChatPreChat => ({
  ...DEFAULT_NESTCHAT_PRECHAT,
  enabled: true,
  ...over,
});

const menu = (over: Partial<NestChatPublicRouting> = {}): NestChatPublicRouting => ({
  prompt: "What can we help with?",
  required: true,
  options: [{ id: "opt_sales", label: "Sales" }],
  ...over,
});

describe("gateFor", () => {
  it("lets a channel with neither half configured straight through", () => {
    expect(gateFor(input()).gated).toBe(false);
  });

  it("puts the form in front of a first-time visitor", () => {
    const gate = gateFor(input({ preChat: form() }));
    expect(gate.gated).toBe(true);
    expect(gate.wantsIdentity).toBe(true);
    expect(gate.blocked).toBe(true);
  });

  it("unblocks once the required fields are filled in", () => {
    const gate = gateFor(
      input({ preChat: form(), form: { name: "Sam", email: "sam@example.com", phone: "" } }),
    );
    expect(gate.blocked).toBe(false);
  });

  it("blocks on an email that isn't one, and says so", () => {
    const gate = gateFor(
      input({ preChat: form(), form: { name: "Sam", email: "sam@example", phone: "" } }),
    );
    expect(gate.emailTypo).toBe(true);
    expect(gate.blocked).toBe(true);
  });

  it("doesn't call an empty optional email a typo", () => {
    const gate = gateFor(
      input({
        preChat: form({ name: { enabled: true, required: false }, email: { enabled: true, required: false } }),
      }),
    );
    expect(gate.emailTypo).toBe(false);
    expect(gate.blocked).toBe(false);
  });

  it("ignores a field that is required but switched off", () => {
    const gate = gateFor(
      input({
        preChat: form({
          name: { enabled: false, required: true },
          email: { enabled: false, required: true },
        }),
      }),
    );
    expect(gate.blocked).toBe(false);
    expect(gate.canSkip).toBe(true);
  });

  it("offers a skip only when nothing is required", () => {
    expect(gateFor(input({ preChat: form() })).canSkip).toBe(false);
    expect(
      gateFor(
        input({
          preChat: form({
            name: { enabled: true, required: false },
            email: { enabled: true, required: false },
          }),
        }),
      ).canSkip,
    ).toBe(true);
  });

  it("won't offer a skip past a required routing menu", () => {
    const optional = form({
      name: { enabled: true, required: false },
      email: { enabled: true, required: false },
    });
    expect(gateFor(input({ preChat: optional, routing: menu() })).canSkip).toBe(false);
    expect(
      gateFor(input({ preChat: optional, routing: menu({ required: false }) })).canSkip,
    ).toBe(true);
  });

  it("still asks what it's about when the visitor is already known", () => {
    // The identity half is remembered across visits; the routing half is not,
    // because a returning customer's next question may be for another team.
    const gate = gateFor(input({ preChat: form(), routing: menu(), identified: true }));
    expect(gate.wantsIdentity).toBe(false);
    expect(gate.wantsOption).toBe(true);
    expect(gate.gated).toBe(true);
    expect(gate.blocked).toBe(true);
    expect(gateFor(input({ preChat: form(), routing: menu(), identified: true, optionId: "opt_sales" })).blocked).toBe(
      false,
    );
  });

  it("asks nothing of a visitor who is known and has already chosen", () => {
    expect(
      gateFor(input({ preChat: form(), routing: menu(), identified: true, chosen: true })).gated,
    ).toBe(false);
  });

  it("never gates an existing conversation", () => {
    // Somebody mid-chat must not meet a form because a setting changed under
    // them — they have already told us who they are by being in the thread.
    expect(gateFor(input({ preChat: form(), routing: menu(), hasThread: true })).gated).toBe(false);
  });

  it("stays out of the way once the form has been answered or skipped", () => {
    expect(gateFor(input({ preChat: form(), startDone: true })).gated).toBe(false);
  });

  it("blocks while a submission is in flight", () => {
    const filled = { name: "Sam", email: "sam@example.com", phone: "" };
    expect(gateFor(input({ preChat: form(), form: filled, starting: true })).blocked).toBe(true);
  });

  it("can offer a routing menu with no form at all", () => {
    const gate = gateFor(input({ routing: menu() }));
    expect(gate.gated).toBe(true);
    expect(gate.wantsIdentity).toBe(false);
    expect(gate.blocked).toBe(true);
  });
});
