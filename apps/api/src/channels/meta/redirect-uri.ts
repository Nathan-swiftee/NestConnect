import type { Request } from "express";

/**
 * The Meta OAuth callback URL, derived from the incoming request so it works
 * across localhost/dev and proxied HTTPS (Railway). This exact value must be
 * listed as a Valid OAuth Redirect URI in the Meta app's Facebook Login settings.
 */
export function metaRedirectUri(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) || (req.secure ? "https" : "http");
  const host = req.get("host");
  return `${proto}://${host}/api/channels/meta/oauth/callback`;
}
