import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { env } from "../../config/env";
import { Public } from "../../auth/public.decorator";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { Store } from "../../data/store";
import { GMAIL_CONFIG, GoogleOAuthService } from "./google-oauth.service";
import { GmailSyncService } from "./gmail-sync.service";
import { googleRedirectUri } from "./redirect-uri";

/** Pub/Sub push delivery envelope (base64 `data` carries the Gmail notice). */
interface PubSubPushBody {
  message?: { data?: string; messageId?: string };
  subscription?: string;
}

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
    private readonly gmailSync: GmailSyncService,
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

      const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
      const channelConfig: Record<string, string> = {
        [GMAIL_CONFIG.provider]: "gmail",
        [GMAIL_CONFIG.email]: email,
        [GMAIL_CONFIG.accessToken]: accessToken,
        [GMAIL_CONFIG.tokenExpiry]: tokenExpiry,
      };
      // Google only returns a refresh token on first consent — keep the old one
      // (already stored) rather than overwriting it with an empty value.
      if (refreshToken) channelConfig[GMAIL_CONFIG.refreshToken] = refreshToken;

      // Reconnecting the same address refreshes the existing channel's tokens
      // instead of creating a duplicate inbox.
      const existing = (await this.store.listInboxes()).find(
        (i) => i.type === "email" && i.handle.toLowerCase() === email.toLowerCase(),
      );
      let inbox;
      if (existing) {
        inbox = (await this.store.updateInbox(existing.id, { channelConfig })) ?? existing;
      } else {
        const teams = await this.store.listTeams();
        inbox = await this.store.createInbox({
          orgId,
          type: "email",
          name: email,
          handle: email,
          teamIds: teams.map((t) => t.id),
          routingStrategy: "round_robin",
          channelConfig,
        });
      }

      // Record the history cursor now so the first poll only picks up mail that
      // arrives after connect — no full-mailbox backfill — and arm push if the
      // org has a Pub/Sub topic configured. (Real mode only.)
      if (!this.google.isMock) {
        await this.gmailSync.establishBaseline(inbox, accessToken);
        await this.gmailSync.armWatch(inbox, accessToken);
      }

      this.sendResult(res, { source: "ding-oauth", ok: true, provider: "gmail", email });
    } catch (err) {
      this.sendResult(res, {
        source: "ding-oauth",
        ok: false,
        error: err instanceof Error ? err.message : "Google connection failed",
      });
    }
  }

  /**
   * Gmail push notifications, delivered by Google Cloud Pub/Sub. The payload
   * carries the affected mailbox address; we ack immediately and sync it in the
   * background so Pub/Sub doesn't retry. Optionally guarded by a shared ?token=.
   */
  @Public()
  @SkipThrottle() // Pub/Sub push can burst; guarded by the shared token
  @Post("push")
  @HttpCode(200)
  async push(
    @Body() body: PubSubPushBody,
    @Query("token") token?: string,
  ): Promise<{ ok: boolean }> {
    // Require the shared secret in production (fail closed); polling still works
    // without push, so this only gates the opt-in Pub/Sub webhook.
    if (env.isProd && !env.gmail.pushToken) {
      throw new UnauthorizedException("Gmail push token required in production (set GMAIL_PUSH_TOKEN)");
    }
    if (env.gmail.pushToken && token !== env.gmail.pushToken) {
      throw new UnauthorizedException("Invalid push token");
    }
    const data = body?.message?.data;
    if (!data) return { ok: true }; // subscription verification / empty control message
    let notice: { emailAddress?: string; historyId?: string };
    try {
      notice = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    } catch {
      return { ok: true }; // malformed — ack so Pub/Sub stops retrying
    }
    if (notice.emailAddress) {
      // Fire-and-forget: ack fast, sync out of band.
      void this.gmailSync.syncInboxByEmail(notice.emailAddress).catch(() => undefined);
    }
    return { ok: true };
  }

  /**
   * On-demand Gmail sync — the "pull to refresh" path. Pulls any new mail now
   * so the caller can refetch and see it immediately. No-op in mock mode / when
   * no Gmail inbox is connected. Authed (not public).
   */
  @Post("sync")
  @HttpCode(200)
  async sync(): Promise<{ ok: boolean; synced: number }> {
    const synced = await this.gmailSync.syncAll();
    return { ok: true, synced };
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
