import { Injectable, Logger, Optional } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { Inbox } from "@ding/schemas";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import { NotificationsService } from "../../notifications/notifications.service";
import { GmailApiError, GmailAuthError, isSignedOutError } from "./gmail-api";

/** AppSetting keys holding the org's Google OAuth app credentials. */
export const GOOGLE_CLIENT_ID_KEY = "google_client_id";
export const GOOGLE_CLIENT_SECRET_KEY = "google_client_secret";
/** AppSetting: the Pub/Sub topic Gmail push notifications publish to (optional). */
export const GOOGLE_PUBSUB_TOPIC_KEY = "google_pubsub_topic";

/** channelConfig keys on a connected Gmail inbox. */
export const GMAIL_CONFIG = {
  provider: "provider",
  email: "email",
  accessToken: "providerToken",
  refreshToken: "refreshToken",
  tokenExpiry: "tokenExpiry",
  /** Gmail history cursor for incremental inbound sync. */
  historyId: "historyId",
  /** ms-epoch string when the current users.watch push subscription expires. */
  watchExpiry: "watchExpiry",
  /** Why Google signed this mailbox out, and when — set until it's reconnected. */
  authError: "authError",
  authErrorAt: "authErrorAt",
} as const;

/** Refresh an access token this many ms before it actually expires. */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

/** Scopes requested during the Gmail consent flow (connect only for now). */
const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

/** The signed OAuth `state`: binds the callback back to the initiating user. */
export interface OAuthState {
  userId: string;
  orgId: string;
  /** Reconnecting this inbox, rather than adding one. */
  inboxId?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

/**
 * Drives the Google "Connect with Google" OAuth 2.0 flow for Gmail. The app's
 * own client id/secret live in AppSettings (Settings › Setup), not in env.
 *
 * When `GOOGLE_OAUTH_MOCK=true` the whole exchange is faked so the popup →
 * connected loop works with no real Google credentials (local/dev).
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    private readonly store: Store,
    // Optional so the checks can build this without the bell.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** True in local/dev mock mode — Google is never actually contacted. */
  private get mock(): boolean {
    return process.env.GOOGLE_OAUTH_MOCK === "true";
  }

  /** Public view of mock mode, so the Gmail provider/sync can short-circuit too. */
  get isMock(): boolean {
    return this.mock;
  }

  private async credentials(orgId: string): Promise<{ clientId: string; clientSecret: string }> {
    const [clientId, clientSecret] = await Promise.all([
      this.store.getPlatformSetting(GOOGLE_CLIENT_ID_KEY),
      this.store.getPlatformSetting(GOOGLE_CLIENT_SECRET_KEY),
    ]);
    return { clientId: (clientId ?? "").trim(), clientSecret: (clientSecret ?? "").trim() };
  }

  /** The stored (non-secret) client id, or "" if unset. */
  async clientId(orgId: string): Promise<string> {
    return (await this.store.getPlatformSetting(GOOGLE_CLIENT_ID_KEY))?.trim() ?? "";
  }

  /** True once both the client id AND secret are set — i.e. we can run the flow. */
  async configured(orgId: string): Promise<boolean> {
    const { clientId, clientSecret } = await this.credentials(orgId);
    return Boolean(clientId && clientSecret);
  }

  /** Sign a short-lived state token so the (cookieless) callback can recover the user. */
  signState(state: OAuthState): string {
    return jwt.sign({ userId: state.userId, orgId: state.orgId, ...(state.inboxId ? { inboxId: state.inboxId } : {}) }, env.auth.jwtSecret, {
      expiresIn: 600,
    });
  }

  /** Verify + decode the state token from the callback. Throws if invalid/expired. */
  verifyState(token: string): OAuthState {
    const payload = jwt.verify(token, env.auth.jwtSecret) as jwt.JwtPayload & Partial<OAuthState>;
    if (!payload.userId || !payload.orgId) throw new Error("Invalid OAuth state");
    return { userId: payload.userId, orgId: payload.orgId, ...(payload.inboxId ? { inboxId: payload.inboxId } : {}) };
  }

  /**
   * The Google consent URL to send the popup to. In mock mode we skip Google
   * and point straight back at our own callback with a fake code, so the popup
   * completes the whole loop locally.
   */
  /** `loginHint`: reconnecting a mailbox, Google offers that account first. */
  async authUrl(orgId: string, redirectUri: string, state: string, loginHint?: string): Promise<string> {
    if (this.mock) {
      return `${redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`;
    }
    const { clientId } = await this.credentials(orgId);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /** Exchange the authorization code for access/refresh tokens. */
  async exchangeCode(orgId: string, code: string, redirectUri: string): Promise<TokenSet> {
    if (this.mock) {
      return { accessToken: "mock-access-token", refreshToken: "mock-refresh-token", expiresIn: 3600 };
    }
    const { clientId, clientSecret } = await this.credentials(orgId);
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new Error(`Google token exchange failed: ${String(err)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Google token exchange failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) throw new Error("Google token response missing access_token");
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in ?? 3600,
    };
  }

  /** Fetch the connected account's email address from the userinfo endpoint. */
  async getEmail(accessToken: string): Promise<string> {
    if (this.mock) return "demo.gmail@gmail.com";
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new Error(`Google userinfo request failed: ${String(err)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Google userinfo request failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { email?: string };
    if (!json.email) throw new Error("Google userinfo response missing email");
    return json.email;
  }

  /** Exchange a stored refresh token for a fresh access token. */
  async refreshAccessToken(
    orgId: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (this.mock) return { accessToken: "mock-access-token", expiresIn: 3600 };
    const { clientId, clientSecret } = await this.credentials(orgId);
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new Error(`Google token refresh failed: ${String(err)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The grant itself is gone — revoked, expired, the password changed, the
      // app's access removed. Signing in again is the only fix.
      if ((res.status === 400 || res.status === 401) && /invalid_grant|unauthorized_client/.test(detail)) {
        throw new GmailAuthError("Google signed this mailbox out — its sign-in was revoked or has expired");
      }
      throw new Error(`Google token refresh failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("Google refresh response missing access_token");
    return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
  }

  /**
   * A currently-valid access token for a connected Gmail inbox. Uses the stored
   * token while it's fresh; otherwise refreshes it and persists the new token +
   * expiry back onto the inbox's channelConfig.
   */
  async accessTokenForInbox(inbox: Inbox, config: Record<string, string>): Promise<string> {
    if (this.mock) return "mock-access-token";
    // Already known to be signed out: say so at once, rather than asking Google again.
    if (config[GMAIL_CONFIG.authError]) throw new GmailAuthError(config[GMAIL_CONFIG.authError]);
    const stored = config[GMAIL_CONFIG.accessToken];
    const expiryIso = config[GMAIL_CONFIG.tokenExpiry];
    const expiresAt = expiryIso ? Date.parse(expiryIso) : 0;
    if (stored && expiresAt && Date.now() < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return stored;
    }
    const refreshToken = config[GMAIL_CONFIG.refreshToken];
    if (!refreshToken) {
      const reason = "There's no saved Google sign-in for this mailbox";
      await this.markSignedOut(inbox, reason);
      throw new GmailAuthError(reason);
    }
    let fresh: { accessToken: string; expiresIn: number };
    try {
      fresh = await this.refreshAccessToken(inbox.orgId, refreshToken);
    } catch (err) {
      if (err instanceof GmailAuthError) await this.markSignedOut(inbox, err.message);
      throw err;
    }
    const { accessToken, expiresIn } = fresh;
    const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    await this.store.updateInbox(inbox.id, {
      channelConfig: { [GMAIL_CONFIG.accessToken]: accessToken, [GMAIL_CONFIG.tokenExpiry]: tokenExpiry },
    });
    this.logger.log(`Refreshed Gmail access token for inbox ${inbox.id}`);
    return accessToken;
  }

  /**
   * After a Gmail call failed: if it means Google has signed the mailbox out,
   * mark it so. Anything else (a blip, a quota) is left for the next try.
   */
  async noteFailure(inbox: Inbox, err: unknown): Promise<void> {
    if (err instanceof GmailAuthError) return; // marked where it was raised
    if (!isSignedOutError(err)) return;
    const status = err instanceof GmailApiError ? err.status : 0;
    await this.markSignedOut(
      inbox,
      status === 403 ? "Google took away this mailbox's permission to read or send mail" : "Google rejected this mailbox's sign-in",
    );
  }

  /**
   * Mark a Gmail inbox as needing to sign in again — once. Until it's
   * reconnected it isn't polled and nothing is sent from it, and the people
   * who can fix it (admins and managers) are told, once, rather than on every
   * failed poll.
   */
  async markSignedOut(inbox: Inbox, reason: string): Promise<void> {
    const config = (await this.store.getInboxConfig(inbox.id)) ?? {};
    if (config[GMAIL_CONFIG.authError]) return;
    await this.store.updateInbox(inbox.id, {
      channelConfig: { [GMAIL_CONFIG.authError]: reason, [GMAIL_CONFIG.authErrorAt]: new Date().toISOString() },
    });
    this.logger.warn(`Gmail inbox ${inbox.handle} needs reconnecting: ${reason}`);
    if (!this.notifications) return;
    const fixers = (await this.store.listMembers()).filter((m) => m.user.role === "admin" || m.user.role === "manager");
    for (const m of fixers) {
      await this.notifications
        .create(m.user.id, {
          type: "channel_reauth",
          title: `${inbox.name} needs reconnecting`,
          body: "Google signed this mailbox out, so new email isn't arriving and replies can't be sent. Reconnect it in Settings › Channels.",
        })
        .catch((e: unknown) => this.logger.warn(`Couldn't tell ${m.user.id} about ${inbox.handle}: ${String(e)}`));
    }
  }
}
