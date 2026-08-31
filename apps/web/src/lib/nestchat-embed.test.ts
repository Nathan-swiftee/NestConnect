import { describe, expect, it } from "vitest";
import { DEFAULT_NESTCHAT_APPEARANCE, nestchatAppearanceSchema } from "@ding/schemas";
import { embedSnippet } from "./nestchat-embed";

const settings = {
  widgetKey: "nc_0123456789abcdef0123456789abcdef",
  embedUrl: "https://nestconnect.io/widget.html?key=nc_0123456789abcdef0123456789abcdef",
  scriptUrl: "https://nestconnect.io/nestchat.js",
};

describe("embedSnippet", () => {
  it("carries the key, the corner and the brand colour into the settings object", () => {
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ accent: "#0FA47A", position: "left" }),
    );
    expect(out).toContain(`src="https://nestconnect.io/nestchat.js"`);
    expect(out).toContain(`key: "nc_0123456789abcdef0123456789abcdef"`);
    expect(out).toContain(`position: "left"`);
    expect(out).toContain(`accent: "#0FA47A"`);
    expect(out.trimEnd().endsWith("</script>")).toBe(true);
  });

  it("puts the config in code, not attributes, so an optimiser can't strip it", () => {
    // SiteGround Optimizer and friends concatenate external scripts into one
    // bundle and drop the original tags. Attributes go with them; an assignment
    // survives. This is the whole reason for the settings object.
    const out = embedSnippet("script", settings, DEFAULT_NESTCHAT_APPEARANCE);
    expect(out).toContain("window.NestChatSettings");
    expect(out).not.toContain("data-key=");
  });

  it("tells the widget which server to load from, not just which key", () => {
    // A combined bundle is served from the customer's own domain, so the widget
    // cannot derive our origin from its own src. Without `host` it would point
    // the iframe at their site.
    const out = embedSnippet("script", settings, DEFAULT_NESTCHAT_APPEARANCE);
    expect(out).toContain(`host: "https://nestconnect.io"`);
  });

  it("points the iframe at the widget page, not the script", () => {
    const out = embedSnippet("iframe", settings, DEFAULT_NESTCHAT_APPEARANCE);
    expect(out).toContain(settings.embedUrl);
    expect(out).not.toContain(settings.scriptUrl);
    expect(out).toContain("</iframe>");
  });

  it("escapes a quote in the business's own words instead of breaking the literal", () => {
    // A launcher label like `Say "hi"` is ordinary copy, and an unescaped quote
    // would end the string early and leave a syntax error on the customer's page.
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ launcherLabel: 'Say "hi"' }),
    );
    expect(out).toContain('label: "Say \\"hi\\""');
  });

  it("escapes a closing script tag hidden in the label", () => {
    // `</script>` inside an inline script ends the block wherever it appears —
    // the rest of the snippet would land on the page as visible text.
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ launcherLabel: "Chat </script> now" }),
    );
    expect(out).not.toContain("</script> now");
    expect(out).toContain("\\u003c/script\\u003e");
    // Exactly one closing tag for the inline block, and one for the loader.
    expect(out.match(/<\/script>/g)).toHaveLength(2);
  });

  it("keeps a multi-line label from breaking the object literal", () => {
    const out = embedSnippet(
      "script",
      settings,
      nestchatAppearanceSchema.parse({ launcherLabel: "Two\nlines" }),
    );
    expect(out).toContain('label: "Two\\nlines"');
    expect(out.split("\n")).toHaveLength(10);
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
