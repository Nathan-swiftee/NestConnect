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
  return scriptSnippet(settings, appearance, []);
}

/**
 * The same snippet for a site with signed-in users: the bubble, plus who is
 * signed in, for the website's templates to fill in on every page.
 *
 * `hash` is the one line that has to come from the website's server — the
 * signing secret must never reach a browser — so it is the one placeholder
 * spelled out as such rather than shown with an example value.
 */
export function signedInSnippet(
  settings: Pick<NestChatSettings, "widgetKey" | "embedUrl" | "scriptUrl">,
  appearance: NestChatAppearance,
): string {
  return scriptSnippet(settings, appearance, [
    `    // the signed-in user — leave out for visitors`,
    `    user: {`,
    `      id: "123",`,
    `      hash: "SIGNED_ON_YOUR_SERVER", // step 2`,
    `      name: "Marta Nowak",`,
    `      email: "marta@example.com",`,
    `      phone: "+447700900123"`,
    `    },`,
    `    fields: { order_id: "DG-88412" } // optional`,
  ]);
}

/** Making `hash` on the website's server, in the languages sites are built in.
 *  The secret goes in the server's environment, never in the page. */
export const SIGNING_EXAMPLES: ReadonlyArray<{ label: string; code: string }> = [
  {
    label: "Node.js",
    code: `const hash = require("crypto")\n  .createHmac("sha256", process.env.NESTCHAT_SECRET)\n  .update(String(user.id))\n  .digest("hex");`,
  },
  {
    label: "PHP",
    code: `$hash = hash_hmac('sha256', (string) $user->id, getenv('NESTCHAT_SECRET'));`,
  },
  {
    label: "Python",
    code: `hash = hmac.new(os.environ["NESTCHAT_SECRET"].encode(),\n                str(user.id).encode(), hashlib.sha256).hexdigest()`,
  },
];

/** For a site where people sign in and out without a page load. */
export const SPA_EXAMPLE = [
  `// after sign-in (hash from your server, as above)`,
  `NestChat.identify({`,
  `  id: "123", hash: "…",`,
  `  name: "Marta Nowak", email: "marta@example.com", phone: "+447700900123"`,
  `});`,
  ``,
  `// on sign-out — the next person on this browser starts fresh`,
  `NestChat.logout();`,
].join("\n");

function scriptSnippet(
  settings: Pick<NestChatSettings, "widgetKey" | "embedUrl" | "scriptUrl">,
  appearance: NestChatAppearance,
  extra: string[],
): string {
  const host = originOf(settings.scriptUrl);
  return [
    `<script>`,
    `  window.NestChatSettings = {`,
    `    key: ${js(settings.widgetKey)},`,
    `    host: ${js(host)},`,
    `    position: ${js(appearance.position)},`,
    `    accent: ${js(appearance.accent)},`,
    `    label: ${js(appearance.launcherLabel)}${extra.length ? "," : ""}`,
    ...extra,
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
