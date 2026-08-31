import type { NestChatAppearance, NestChatSettings } from "@ding/schemas";

export type EmbedKind = "script" | "iframe";

/**
 * The snippet a customer pastes into their own website.
 *
 * Its own module rather than a template literal inside the settings pane,
 * because it is a string that is copied straight into somebody's production
 * HTML: a stray quote here is a broken page there, and nothing in a typecheck
 * or a screenshot would notice. Here it can be asserted on.
 */
export function embedSnippet(
  kind: EmbedKind,
  settings: Pick<NestChatSettings, "widgetKey" | "embedUrl" | "scriptUrl">,
  appearance: NestChatAppearance,
): string {
  if (kind === "iframe") {
    return [
      `<iframe src="${settings.embedUrl}"`,
      `        title="${attr(appearance.title)}"`,
      `        style="border:0;width:100%;height:600px"></iframe>`,
    ].join("\n");
  }
  // Configuration goes in a settings object, not in data- attributes on the
  // script tag. Site optimisers (SiteGround Optimizer, WP Rocket, Autoptimize)
  // concatenate external scripts into one bundle and drop the original tags —
  // taking every attribute with them, and leaving a bundle whose src is the
  // customer's own domain rather than ours. A settings object is code, so it
  // survives; and it carries `host`, so the widget never has to guess where we
  // are. The host is also why the two tags can't be collapsed into one.
  const host = originOf(settings.scriptUrl);
  return [
    `<script>`,
    `  window.NestChatSettings = {`,
    `    key: ${js(settings.widgetKey)},`,
    `    host: ${js(host)},`,
    `    position: ${js(appearance.position)},`,
    `    accent: ${js(appearance.accent)},`,
    `    label: ${js(appearance.launcherLabel)}`,
    `  };`,
    `</script>`,
    `<script src="${settings.scriptUrl}" defer></script>`,
  ].join("\n");
}

/** The scheme + host the loader is served from — what the widget iframe and the
 *  visitor API are reached on, whatever the host page's own origin is. */
function originOf(scriptUrl: string): string {
  try {
    return new URL(scriptUrl).origin;
  } catch {
    // A relative or malformed scriptUrl: strip the path and hope, rather than
    // emit a snippet with an exception in it.
    return scriptUrl.replace(/\/[^/]*$/, "");
  }
}

/**
 * A JavaScript string literal for a value going into an inline `<script>`.
 *
 * JSON.stringify does the quoting, but `<` has to be escaped on top of it: a
 * launcher label containing `</script>` would otherwise end the block early and
 * spill the rest of the snippet onto the page as text.
 */
function js(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/**
 * Make a business's own words safe to sit inside a double-quoted HTML attribute.
 *
 * They chose the launcher label and the title, so this is not a trust boundary —
 * but a perfectly innocent `Say "hi"` would still end the attribute early and
 * produce a snippet that silently breaks their page.
 */
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ");
}
