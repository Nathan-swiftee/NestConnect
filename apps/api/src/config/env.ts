import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "dotenv";

// Load env from the repo root (dev runs each app from its own dir), then any
// local override. Everything has a default, so the app also runs with no .env.
for (const p of [
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), ".env"),
]) {
  if (existsSync(p)) config({ path: p, override: false });
}

export const env = {
  // Railway (and most PaaS) inject PORT; fall back to API_PORT for local dev.
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Public origin of the web app, used to build links (e.g. invite emails).
  // Defaults to the CORS origin (same-origin in prod).
  appUrl: process.env.APP_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  whatsapp: {
    // Verification token you set in the Meta webhook config.
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "ding-dev-verify",
    // App secret → validates X-Hub-Signature-256 on inbound webhooks (optional in dev).
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    // Access token + phone number id → enables live sending. Without them a send
    // fails (or is faked only when MOCK_MESSAGING=true in dev).
    token: process.env.WHATSAPP_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  },
  auth: {
    jwtSecret: process.env.AUTH_JWT_SECRET ?? "ding-dev-secret-change-me",
    cookieName: process.env.AUTH_COOKIE_NAME ?? "ding_session",
    // Session lifetime in seconds (default 7 days).
    ttlSeconds: Number(process.env.AUTH_TTL_SECONDS ?? 60 * 60 * 24 * 7),
    // Password for all seeded demo users (dev only).
    devPassword: process.env.AUTH_DEV_PASSWORD ?? "ding1234",
  },
  // Master key for encrypting integration secrets at rest (AES-256-GCM). Loaded
  // from the environment only — never stored in Postgres. Prefer a base64- or
  // hex-encoded 32-byte random key; any other non-empty value is stretched with
  // SHA-256. Unset ⇒ encryption disabled (secrets stored as plaintext).
  secretKey: process.env.SECRET_ENCRYPTION_KEY ?? "",
  email: {
    // Postmark server token → enables live sending. Without it a send fails
    // (or is faked only when MOCK_MESSAGING=true in dev).
    postmarkToken: process.env.POSTMARK_TOKEN ?? "",
    // Address outbound email is sent from, and the domain used to mint Message-IDs.
    from: process.env.EMAIL_FROM ?? "support@swiftee.co.uk",
    domain: process.env.EMAIL_DOMAIN ?? "swiftee.co.uk",
    // Optional shared secret; when set, inbound webhooks must pass ?token=.
    inboundToken: process.env.EMAIL_INBOUND_TOKEN ?? "",
  },
  // SMTP for the app's OWN transactional email (invites, password resets, test
  // sends) — distinct from the customer-facing email channel above. Defaults
  // suit Gmail with an app password. An org's saved Setup values override these.
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    username: process.env.SMTP_USERNAME ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    // Envelope + header From; falls back to the username (the Gmail address).
    from: process.env.SMTP_FROM ?? "",
    // true → implicit TLS on connect (port 465); false → STARTTLS (port 587).
    secure: (process.env.SMTP_SECURE ?? "") === "true",
  },
  gmail: {
    // Inbound polling cadence in seconds; 0 disables the poller (push-only).
    pollSeconds: Number(process.env.GMAIL_POLL_SECONDS ?? 60),
    // Optional shared secret; when set, the Pub/Sub push webhook must pass ?token=.
    pushToken: process.env.GMAIL_PUSH_TOKEN ?? "",
  },
  media: {
    // Where downloaded media is stored on the local-disk driver. Ephemeral on
    // Railway; production durability comes from Cloudflare R2 (below).
    dir: process.env.MEDIA_DIR ?? join(tmpdir(), "nest-media"),
    // Hard cap on a single media file we'll download/store (bytes). Default 100MB.
    maxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 100 * 1024 * 1024),
  },
  r2: {
    // Cloudflare R2 (S3-compatible). Set all four to store media in R2 instead
    // of local disk. Endpoint is https://<accountId>.r2.cloudflarestorage.com.
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "",
  },
  get usingDatabase() {
    return this.databaseUrl.length > 0;
  },
  get usingRedis() {
    return this.redisUrl.length > 0;
  },
  get whatsappLive() {
    return Boolean(this.whatsapp.token && this.whatsapp.phoneNumberId);
  },
  get emailLive() {
    return Boolean(this.email.postmarkToken);
  },
  /** Dev/demo escape hatch. When MOCK_MESSAGING=true (and NOT production), a send
   *  on an unconnected channel is faked so the flow is exercisable without live
   *  credentials. Off by default and force-off in production, where an
   *  unconnected channel fails the send — surfaced to the agent — instead of
   *  silently pretending the message went out. */
  get mockMessaging() {
    return !this.isProd && process.env.MOCK_MESSAGING === "true";
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  // In production the API also serves the built web app (single origin).
  get serveWeb() {
    return this.isProd || process.env.SERVE_WEB === "true";
  },
};

const DEFAULT_JWT_SECRET = "ding-dev-secret-change-me";

/**
 * Fail closed on boot if production is running on insecure defaults. Only the
 * session-signing secret is boot-critical (a public default lets anyone forge an
 * admin cookie); per-channel secrets are enforced at request time instead, since
 * they're legitimately unset until a channel is wired. Weaker prod defaults are
 * warned about, not fatal.
 */
export function assertProdSecrets(logger: { warn: (m: string) => void } = console): void {
  if (!env.isProd) return;
  if (!process.env.AUTH_JWT_SECRET || process.env.AUTH_JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error(
      "Refusing to start in production with an insecure AUTH_JWT_SECRET. Set a strong, random value.",
    );
  }
  if (env.corsOrigin.includes("localhost")) {
    logger.warn(`CORS_ORIGIN is still "${env.corsOrigin}" in production — set it to your real web origin.`);
  }
  if (env.auth.devPassword === "ding1234") {
    logger.warn("AUTH_DEV_PASSWORD is the built-in default — seeded demo users share it. Invite real users to get unique credentials.");
  }
  if (!env.secretKey) {
    logger.warn("SECRET_ENCRYPTION_KEY is not set — integration credentials (OAuth tokens, app secrets) are stored UNENCRYPTED. Set a 32-byte key and run `pnpm --filter @ding/api db:encrypt-secrets`.");
  }
}
