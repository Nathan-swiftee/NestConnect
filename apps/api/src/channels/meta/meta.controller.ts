import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { connectCoexistenceInputSchema, type CoexistenceSetup, type ConnectCoexistenceInput } from "@ding/schemas";
import { Public } from "../../auth/public.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUserId } from "../../auth/current-user.decorator";
import { Store } from "../../data/store";
import { SandboxPolicy } from "../../tenancy/sandbox";
import { bindTenant } from "../../tenancy/tenant-scope";
import { META_CONFIG, MetaOAuthService } from "./meta-oauth.service";
import { metaRedirectUri } from "./redirect-uri";
import { env } from "../../config/env";

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
  private readonly logger = new Logger(MetaController.name);

  constructor(
    private readonly meta: MetaOAuthService,
    private readonly store: Store,
    private readonly sandbox: SandboxPolicy,
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
    if (await this.sandbox.current()) {
      this.sendResult(res, { source: "ding-oauth", ok: false, error: "Connecting channels isn't available in the demo workspace" });
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
      // The redirect carries no session; the signed state says whose workspace
      // started the flow, and the rest of it acts there.
      bindTenant(orgId);
      await this.sandbox.assertLive("Connecting a channel");

      const accessToken = await this.meta.exchangeCode(orgId, code, metaRedirectUri(req));
      const number = await this.meta.discoverNumber(accessToken);
      // One number, one workspace: a message to it must never be able to match
      // inboxes in two of them.
      if (await this.store.channelKeyTaken({ phoneNumberId: number.phoneNumberId })) {
        throw new Error(`${number.displayNumber} is already connected to another workspace`);
      }
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
        // Created unrouted — the admin sets the team(s) + strategy in the editor
        // that opens right after connecting, instead of routing to every team.
        await this.store.createInbox({
          orgId,
          type: "whatsapp",
          name,
          handle: number.phoneNumberId,
          teamIds: [],
          routingStrategy: "manual",
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

  /**
   * What the browser needs to open Meta's sign-up for a WhatsApp Business app
   * number. The app id and configuration id are public by nature (Meta's SDK
   * puts them in the page); the secret never leaves the server.
   */
  @Get("coexistence/setup")
  async coexistenceSetup(@CurrentUserId() userId: string): Promise<CoexistenceSetup> {
    const user = await this.store.getUser(userId);
    if (!user) throw new ForbiddenException("Not signed in");
    const [appId, configId, configured] = await Promise.all([
      this.meta.appId(user.orgId),
      this.meta.configId(user.orgId),
      this.meta.configured(user.orgId),
    ]);
    return {
      appId,
      configId,
      graphVersion: env.whatsapp.apiVersion,
      ready: this.meta.isMock || (configured && !!configId),
      mock: this.meta.isMock,
    };
  }

  /**
   * Connect a number that stays on the WhatsApp Business app (Meta's
   * "coexistence"). The browser ran Meta's sign-up with the SDK: the person
   * chose "connect your existing WhatsApp Business app" and scanned the QR code
   * on the phone. It sends us the code and the account + number Meta said it
   * onboarded.
   *
   * The number is never put through the API's `register` step — Meta has
   * already linked it, and registering would take it off the phone. Instead,
   * the phone's contacts and chat history are asked for straight away: Meta
   * only allows that once, in the first 24 hours.
   */
  @Post("coexistence")
  async connectCoexistence(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(connectCoexistenceInputSchema)) body: ConnectCoexistenceInput,
  ): Promise<{ inboxId: string; handle: string; displayNumber: string; sync: string }> {
    const user = await this.store.getUser(userId);
    if (!user) throw new ForbiddenException("Not signed in");
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can connect channels");
    }
    await this.sandbox.assertLive("Connecting a channel");
    if (!this.meta.isMock && !(await this.meta.configured(user.orgId))) {
      throw new BadRequestException("Meta credentials not set — add them in Settings › Setup");
    }

    let accessToken: string;
    let number: Awaited<ReturnType<MetaOAuthService["onboardedNumber"]>>;
    try {
      accessToken = await this.meta.exchangeSdkCode(user.orgId, body.code);
      number = await this.meta.onboardedNumber(body.wabaId, body.phoneNumberId, accessToken);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "Meta didn't complete the connection");
    }
    // One number, one workspace.
    if (await this.store.channelKeyTaken({ phoneNumberId: number.phoneNumberId })) {
      throw new BadRequestException(`${number.displayNumber} is already connected to another workspace`);
    }
    await this.meta.subscribeApp(number.wabaId, accessToken);

    const name = number.verifiedName ? `${number.verifiedName} (${number.displayNumber})` : number.displayNumber;
    const channelConfig: Record<string, string> = {
      [META_CONFIG.provider]: "meta_cloud",
      [META_CONFIG.phoneNumberId]: number.phoneNumberId,
      [META_CONFIG.accessToken]: accessToken,
      [META_CONFIG.wabaId]: number.wabaId,
      [META_CONFIG.displayNumber]: number.displayNumber,
      [META_CONFIG.coexistence]: "true",
      [META_CONFIG.coexistenceState]: "connected",
    };
    const existing = (await this.store.listInboxes()).find((i) => i.type === "whatsapp" && i.handle === number.phoneNumberId);
    const inbox = existing
      ? (await this.store.updateInbox(existing.id, { channelConfig }))!
      : // Unrouted until the admin chooses, as with every one-click connect.
        await this.store.createInbox({
          orgId: user.orgId,
          type: "whatsapp",
          name,
          handle: number.phoneNumberId,
          teamIds: [],
          routingStrategy: "manual",
          channelConfig,
        });

    // Contacts first, then history: a history thread then finds its customer
    // already there, with the name the phone knew them by.
    let sync: string;
    try {
      await this.meta.requestAppData(number.phoneNumberId, accessToken, "smb_app_state_sync");
      await this.meta.requestAppData(number.phoneNumberId, accessToken, "history");
      sync = `requested ${new Date().toISOString()}`;
    } catch (err) {
      sync = `failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
      this.logger.warn(`Coexistence sync request for ${number.phoneNumberId} ${sync}`);
    }
    await this.store.updateInbox(inbox.id, { channelConfig: { [META_CONFIG.coexistenceSync]: sync } });
    this.logger.log(`Connected WhatsApp Business app number ${number.displayNumber} (coexistence) to inbox ${inbox.id}`);
    return { inboxId: inbox.id, handle: number.phoneNumberId, displayNumber: number.displayNumber, sync };
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
