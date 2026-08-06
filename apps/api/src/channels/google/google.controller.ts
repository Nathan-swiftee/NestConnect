import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../auth/public.decorator";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { Store } from "../../data/store";
import { GoogleOAuthService } from "./google-oauth.service";
import { googleRedirectUri } from "./redirect-uri";

/** The message the popup posts back to the opener window. */
interface OAuthMessage {
  source: "ding-oauth";
  ok: boolean;
  provider?: string;
  email?: string;
  error?: string;
}

@Controller("channels/google")
export class GoogleController {
  constructor(
    private readonly google: GoogleOAuthService,
    private readonly store: Store,
  ) {}

  /**
   * Kick off the consent flow. Same-origin popup, so the session cookie is sent
   * and the route stays authenticated. Redirects to Google (or, in mock mode,
   * straight back to our own callback).
   */
  @Get("oauth/start")
  async start(
    @CurrentUserId() userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const redirectUri = googleRedirectUri(req);
    const user = await this.store.getUser(userId);
    if (!user) {
      this.sendResult(res, { source: "ding-oauth", ok: false, error: "Not signed in" });
      return;
    }
    if (!(await this.google.configured(user.orgId))) {
      this.sendResult(res, {
        source: "ding-oauth",
        ok: false,
        error: "Google credentials not set — add them in Settings › Setup",
      });
      return;
    }
    const state = this.google.signState({ userId: user.id, orgId: user.orgId });
    const authUrl = await this.google.authUrl(user.orgId, redirectUri, state);
    res.redirect(302, authUrl);
  }

  /**
   * Google's redirect target. Public — Google's redirect carries no session
   * cookie, so the initiating user is recovered from the signed `state` instead.
   */
  @Public()
  @Get("oauth/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!code) throw new Error("Missing authorization code");
      if (!state) throw new Error("Missing state");
      const { userId, orgId } = this.google.verifyState(state);
      void userId; // bound for CSRF/user verification; teams drive routing below

      const redirectUri = googleRedirectUri(req);
      const { accessToken, refreshToken, expiresIn } = await this.google.exchangeCode(
        orgId,
        code,
        redirectUri,
      );
      const email = await this.google.getEmail(accessToken);

      const teams = await this.store.listTeams();
      const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
      await this.store.createInbox({
        orgId,
        type: "email",
        name: email,
        handle: email,
        teamIds: teams.map((t) => t.id),
        routingStrategy: "round_robin",
        channelConfig: {
          provider: "gmail",
          email,
          providerToken: accessToken,
          refreshToken: refreshToken ?? "",
          tokenExpiry,
        },
      });

      this.sendResult(res, { source: "ding-oauth", ok: true, provider: "gmail", email });
    } catch (err) {
      this.sendResult(res, {
        source: "ding-oauth",
        ok: false,
        error: err instanceof Error ? err.message : "Google connection failed",
      });
    }
  }

  /** Render the tiny HTML page that posts the result to the opener and closes. */
  private sendResult(res: Response, message: OAuthMessage): void {
    const payload = JSON.stringify(message).replace(/</g, "\\u003c");
    const fallback = message.ok
      ? "Connected — you can close this window."
      : `Couldn't connect: ${message.error ?? "unknown error"}`;
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Google connection</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1c2b24;background:#f6f8f7">
<main style="text-align:center;padding:24px;max-width:340px">
<p style="font-size:15px;line-height:1.5">${escapeHtml(fallback)}</p>
</main>
<script>
(function () {
  var msg = ${payload};
  try { if (window.opener) window.opener.postMessage(msg, "*"); } catch (e) {}
  window.close();
})();
</script>
</body>
</html>`;
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  }
}

/** Escape user-facing text placed into the HTML fallback body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
