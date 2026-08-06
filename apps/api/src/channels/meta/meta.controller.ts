import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../auth/public.decorator";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { Store } from "../../data/store";
import { META_CONFIG, MetaOAuthService } from "./meta-oauth.service";
import { metaRedirectUri } from "./redirect-uri";

/** The message the popup posts back to the opener window. */
interface OAuthMessage {
  source: "ding-oauth";
  ok: boolean;
  provider?: string;
  number?: string;
  error?: string;
}

@Controller("channels/meta")
export class MetaController {
  constructor(
    private readonly meta: MetaOAuthService,
    private readonly store: Store,
  ) {}

  /**
   * Kick off the WhatsApp connect flow. Same-origin popup, so the session cookie
   * is sent and the route stays authenticated. Redirects to Facebook (or, in
   * mock mode, straight back to our own callback).
   */
  @Get("oauth/start")
  async start(
    @CurrentUserId() userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.store.getUser(userId);
    if (!user) {
      this.sendResult(res, { source: "ding-oauth", ok: false, error: "Not signed in" });
      return;
    }
    if (!(await this.meta.configured(user.orgId))) {
      this.sendResult(res, {
        source: "ding-oauth",
        ok: false,
        error: "Meta credentials not set — add them in Settings › Setup",
      });
      return;
    }
    const state = this.meta.signState({ userId: user.id, orgId: user.orgId });
    const authUrl = await this.meta.authUrl(user.orgId, metaRedirectUri(req), state);
    res.redirect(302, authUrl);
  }

  /**
   * Facebook's redirect target. Public — the redirect carries no session cookie,
   * so the initiating user is recovered from the signed `state` instead.
   */
  @Public()
  @Get("oauth/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (errorDescription) throw new Error(errorDescription);
      if (!code) throw new Error("Missing authorization code");
      if (!state) throw new Error("Missing state");
      const { orgId } = this.meta.verifyState(state);

      const accessToken = await this.meta.exchangeCode(orgId, code, metaRedirectUri(req));
      const number = await this.meta.discoverNumber(accessToken);
      await this.meta.subscribeApp(number.wabaId, accessToken);

      const name = number.verifiedName
        ? `${number.verifiedName} (${number.displayNumber})`
        : number.displayNumber;
      const channelConfig: Record<string, string> = {
        [META_CONFIG.provider]: "meta_cloud",
        [META_CONFIG.phoneNumberId]: number.phoneNumberId,
        [META_CONFIG.accessToken]: accessToken,
        [META_CONFIG.wabaId]: number.wabaId,
        [META_CONFIG.displayNumber]: number.displayNumber,
      };

      // Reconnecting the same number refreshes its token instead of duplicating.
      const existing = (await this.store.listInboxes()).find(
        (i) => i.type === "whatsapp" && i.handle === number.phoneNumberId,
      );
      if (existing) {
        await this.store.updateInbox(existing.id, { name, channelConfig });
      } else {
        const teams = await this.store.listTeams();
        await this.store.createInbox({
          orgId,
          type: "whatsapp",
          name,
          handle: number.phoneNumberId,
          teamIds: teams.map((t) => t.id),
          routingStrategy: "round_robin",
          channelConfig,
        });
      }

      this.sendResult(res, {
        source: "ding-oauth",
        ok: true,
        provider: "whatsapp",
        number: number.displayNumber,
      });
    } catch (err) {
      this.sendResult(res, {
        source: "ding-oauth",
        ok: false,
        error: err instanceof Error ? err.message : "WhatsApp connection failed",
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
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>WhatsApp connection</title></head>
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
