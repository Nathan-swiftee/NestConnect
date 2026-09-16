import { describe, expect, it } from "vitest";
import { DEFAULT_NESTCHAT_APP } from "@ding/schemas";
import { appSetupGuide, type AppSetupInput } from "./nestchat-app-setup";

const base: AppSetupInput = {
  apiUrl: "https://api.nestconnect.io",
  appKey: "na_abc123",
  app: { ...DEFAULT_NESTCHAT_APP, enabled: true },
  hasIdentitySecret: false,
  hasPushCredential: false,
  fieldKeys: [],
};

const guide = (over: Partial<AppSetupInput> = {}) => appSetupGuide({ ...base, ...over });
const all = (over: Partial<AppSetupInput> = {}) =>
  guide(over)
    .map((s) => [s.title, s.body, s.code ?? "", s.blocked ?? ""].join("\n"))
    .join("\n");
const blockers = (over: Partial<AppSetupInput> = {}) =>
  guide(over)
    .map((s) => s.blocked)
    .filter(Boolean) as string[];

describe("the app setup guide", () => {
  it("uses the channel's real key and host, not a placeholder", () => {
    const text = all();
    expect(text).toContain("na_abc123");
    expect(text).toContain("https://api.nestconnect.io");
    // The whole point of generating it: nothing for the integrator to guess.
    expect(text).not.toContain("…'");
  });

  it("says the key is missing rather than printing a fake one", () => {
    const steps = guide({ appKey: undefined });
    const create = steps.find((s) => s.title.includes("Create the chat"))!;
    expect(create.blocked).toMatch(/turn the in-app sdk on/i);
  });

  it("nothing is flagged once the channel is fully set up", () => {
    expect(
      blockers({
        hasIdentitySecret: true,
        hasPushCredential: true,
        app: { ...base.app, identity: "required" },
      }),
    ).toEqual([]);
  });
});

describe("identity", () => {
  it("optional says plainly what is unprotected meanwhile", () => {
    const [warning] = blockers({ app: { ...base.app, identity: "optional" } }).filter((b) =>
      /claim to be any of your customers/.test(b),
    );
    // The gap is real while it lasts, and a guide that only says "optional"
    // reads as "fine".
    expect(warning).toBeTruthy();
  });

  it("required with no secret is called out, because every session would be anonymous", () => {
    const steps = guide({ app: { ...base.app, identity: "required" }, hasIdentitySecret: false });
    expect(steps.find((s) => s.title === "Say who the user is")?.blocked).toMatch(
      /no signing secret/i,
    );
  });

  it("off asks for no hash at all", () => {
    const steps = guide({ app: { ...base.app, identity: "off" } });
    expect(steps.find((s) => s.title === "Say who the user is")?.code).not.toContain("userHash");
    // …and there is nothing for a backend to sign.
    expect(steps.some((s) => s.title.includes("Sign user ids"))).toBe(false);
  });

  it("never puts the signing secret anywhere near the app", () => {
    const signing = guide({ app: { ...base.app, identity: "optional" } }).find((s) =>
      s.title.includes("Sign user ids"),
    )!;
    expect(signing.body).toMatch(/never put the secret in the app/i);
    expect(signing.code).toContain("on your own server");
  });
});

describe("fields", () => {
  it("names the fields this channel actually accepts", () => {
    const text = all({ fieldKeys: ["order_id", "restaurant"] });
    expect(text).toContain("order_id");
    expect(text).toContain("restaurant");
  });

  it("the thread key leads the example, so it is the one they copy", () => {
    const steps = guide({
      fieldKeys: ["restaurant", "order_id"],
      app: { ...base.app, threadFieldKey: "order_id" },
    });
    const code = steps.find((s) => s.title.startsWith("Open it"))!.code!;
    expect(code.indexOf("order_id")).toBeLessThan(code.indexOf("restaurant"));
  });

  it("a thread key with no matching field is a blocker, not a silent merge", () => {
    // Every conversation would share one thread, which looks exactly like the
    // setting working until somebody notices a year of orders in one chat.
    const steps = guide({ fieldKeys: ["restaurant"], app: { ...base.app, threadFieldKey: "order_id" } });
    expect(steps.find((s) => s.title.startsWith("Open it"))?.blocked).toMatch(/one thread/i);
  });

  it("with no fields defined it says where to define them", () => {
    expect(all()).toMatch(/Settings › Custom fields/);
  });
});

describe("notifications", () => {
  it("names the Android channel id exactly, since a wrong one fails silently", () => {
    expect(all()).toContain("nest_messages");
  });

  it("no Firebase key is a blocker", () => {
    const steps = guide({ hasPushCredential: false });
    expect(steps.find((s) => s.title === "Notifications")?.blocked).toMatch(/service-account key/i);
  });

  it("with a key there is nothing to flag", () => {
    const steps = guide({ hasPushCredential: true });
    expect(steps.find((s) => s.title === "Notifications")?.blocked).toBeUndefined();
  });
});

describe("the Dart it hands out", () => {
  it("calls only what the SDK actually exposes", () => {
    const code = guide({ fieldKeys: ["order_id"], hasPushCredential: true })
      .map((s) => s.code ?? "")
      .join("\n");
    for (const call of [
      "NestConnect(",
      "chat.login(",
      "chat.open(",
      "showNestMessenger(context, chat: chat)",
      "NestLauncher(",
      "chat.registerPushToken",
      "chat.logout()",
    ]) {
      expect(code).toContain(call);
    }
  });

  it("balances every bracket it opens", () => {
    // This is pasted straight into somebody's app; an unclosed paren here is a
    // build failure there, and nothing else in our tooling would notice.
    for (const step of guide({ fieldKeys: ["order_id"] })) {
      const code = step.code ?? "";
      for (const [open, close] of [["(", ")"], ["{", "}"], ["[", "]"]]) {
        expect([step.title, code.split(open).length]).toEqual([
          step.title,
          code.split(close).length,
        ]);
      }
    }
  });
});
