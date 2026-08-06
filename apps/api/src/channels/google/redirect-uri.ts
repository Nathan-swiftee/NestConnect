import type { Request } from "express";

/**
 * The Google OAuth callback URL, derived from the incoming request so it works
 * across localhost/dev and proxied HTTPS (Railway). The start/callback routes
 * and the Settings › Setup redirect-URI display must agree on this exact value —
 * it's the URL the user registers in their Google Cloud OAuth client.
 */
export function googleRedirectUri(req: Request): string {
  return `${baseUrl(req)}/api/channels/google/oauth/callback`;
}

/** The URL to register as the Gmail push (Pub/Sub) subscription endpoint. */
export function googlePushEndpoint(req: Request): string {
  return `${baseUrl(req)}/api/channels/google/push`;
}

function baseUrl(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) || (req.secure ? "https" : "http");
  const host = req.get("host");
  return `${proto}://${host}`;
}
