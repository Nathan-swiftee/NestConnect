import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { Store } from "../../data/store";

/** AppSetting keys holding the org's Google OAuth app credentials. */
export const GOOGLE_CLIENT_ID_KEY = "google_client_id";
export const GOOGLE_CLIENT_SECRET_KEY = "google_client_secret";

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
  constructor(private readonly store: Store) {}

  /** True in local/dev mock mode — Google is never actually contacted. */
  private get mock(): boolean {
    return process.env.GOOGLE_OAUTH_MOCK === "true";
  }

  private async credentials(orgId: string): Promise<{ clientId: string; clientSecret: string }> {
    const [clientId, clientSecret] = await Promise.all([
      this.store.getAppSetting(orgId, GOOGLE_CLIENT_ID_KEY),
      this.store.getAppSetting(orgId, GOOGLE_CLIENT_SECRET_KEY),
    ]);
    return { clientId: (clientId ?? "").trim(), clientSecret: (clientSecret ?? "").trim() };
  }

  /** The stored (non-secret) client id, or "" if unset. */
  async clientId(orgId: string): Promise<string> {
    return (await this.store.getAppSetting(orgId, GOOGLE_CLIENT_ID_KEY))?.trim() ?? "";
  }

  /** True once both the client id AND secret are set — i.e. we can run the flow. */
  async configured(orgId: string): Promise<boolean> {
    const { clientId, clientSecret } = await this.credentials(orgId);
    return Boolean(clientId && clientSecret);
  }

  /** Sign a short-lived state token so the (cookieless) callback can recover the user. */
  signState(state: OAuthState): string {
    return jwt.sign({ userId: state.userId, orgId: state.orgId }, env.auth.jwtSecret, {
      expiresIn: 600,
    });
  }

  /** Verify + decode the state token from the callback. Throws if invalid/expired. */
  verifyState(token: string): OAuthState {
    const payload = jwt.verify(token, env.auth.jwtSecret) as jwt.JwtPayload & Partial<OAuthState>;
    if (!payload.userId || !payload.orgId) throw new Error("Invalid OAuth state");
    return { userId: payload.userId, orgId: payload.orgId };
  }

  /**
   * The Google consent URL to send the popup to. In mock mode we skip Google
   * and point straight back at our own callback with a fake code, so the popup
   * completes the whole loop locally.
   */
  async authUrl(orgId: string, redirectUri: string, state: string): Promise<string> {
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
}
