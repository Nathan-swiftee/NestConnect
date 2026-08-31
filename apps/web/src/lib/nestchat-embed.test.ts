import { describe, expect, it } from "vitest";
import { DEFAULT_NESTCHAT_APPEARANCE, nestchatAppearanceSchema } from "@ding/schemas";
import { embedSnippet } from "./nestchat-embed";

const settings = {
  widgetKey: "nc_0123456789abcdef0123456789abcdef",
  embedUrl: "https://nestconnect.io/widget.html?key=nc_0123456789abcdef0123456789abcdef",
  scriptUrl: "https://nestconnect.io/nestchat.js",
};

describe("embedSnippet", () => {
  it("carries the key, the corner and the brand colour into the script tag", () => {
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ accent: "#0FA47A", position: "left" }),
    );
    expect(out).toContain(`src="https://nestconnect.io/nestchat.js"`);
    expect(out).toContain(`data-key="nc_0123456789abcdef0123456789abcdef"`);
    expect(out).toContain(`data-position="left"`);
    expect(out).toContain(`data-accent="#0FA47A"`);
    expect(out.trimEnd().endsWith("</script>")).toBe(true);
  });

  it("points the iframe at the widget page, not the script", () => {
    const out = embedSnippet("iframe", settings, DEFAULT_NESTCHAT_APPEARANCE);
    expect(out).toContain(settings.embedUrl);
    expect(out).not.toContain(settings.scriptUrl);
    expect(out).toContain("</iframe>");
  });

  it("escapes a quote in the business's own words instead of breaking the tag", () => {
    // A launcher label like `Say "hi"` is ordinary copy, and would otherwise end
    // the attribute early and leave a broken tag on the customer's page.
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ launcherLabel: 'Say "hi" <now>' }),
    );
    expect(out).toContain(`data-label="Say &quot;hi&quot; &lt;now&gt;"`);
    // One attribute, not three: the quotes did not split it.
    expect(out.match(/data-label=/g)).toHaveLength(1);
  });

  it("keeps the snippet to one line per attribute", () => {
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ launcherLabel: "Two\nlines" }),
    );
    expect(out.split("\n")).toHaveLength(6);
  });
});

describe("nestchat appearance", () => {
  it("fills every field from an empty object, so a new channel is never blank", () => {
    const parsed = nestchatAppearanceSchema.parse({});
    expect(parsed.title).toBeTruthy();
    expect(parsed.placeholder).toBeTruthy();
    expect(parsed.accent).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    expect(parsed).toEqual(DEFAULT_NESTCHAT_APPEARANCE);
  });

  it("refuses a colour that isn't one — it lands in a CSS custom property", () => {
    expect(nestchatAppearanceSchema.safeParse({ accent: "red" }).success).toBe(false);
    expect(
      nestchatAppearanceSchema.safeParse({ accent: "#fff; background:url(x)" }).success,
    ).toBe(false);
    expect(nestchatAppearanceSchema.safeParse({ accent: "#0FA47A" }).success).toBe(true);
  });

  it("merges a patch over what is stored without blanking the rest", () => {
    const stored = nestchatAppearanceSchema.parse({ title: "Swiftee support" });
    const merged = nestchatAppearanceSchema.parse({ ...stored, greeting: "Ask us anything." });
    expect(merged.title).toBe("Swiftee support");
    expect(merged.greeting).toBe("Ask us anything.");
    expect(merged.placeholder).toBe(DEFAULT_NESTCHAT_APPEARANCE.placeholder);
  });
});
