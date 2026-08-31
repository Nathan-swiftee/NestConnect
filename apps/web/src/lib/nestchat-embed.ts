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
  return [
    `<script src="${settings.scriptUrl}"`,
    `        data-key="${settings.widgetKey}"`,
    `        data-position="${appearance.position}"`,
    `        data-accent="${appearance.accent}"`,
    `        data-label="${attr(appearance.launcherLabel)}"`,
    `        defer></script>`,
  ].join("\n");
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
