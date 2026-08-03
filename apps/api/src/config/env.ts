import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  whatsapp: {
    // Verification token you set in the Meta webhook config.
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "ding-dev-verify",
    // App secret → validates X-Hub-Signature-256 on inbound webhooks (optional in dev).
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    // Access token + phone number id → enables live sending (else the provider mocks).
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
  email: {
    // Postmark server token → enables live sending (else the provider mocks).
    postmarkToken: process.env.POSTMARK_TOKEN ?? "",
    // Address outbound email is sent from, and the domain used to mint Message-IDs.
    from: process.env.EMAIL_FROM ?? "support@swiftee.co.uk",
    domain: process.env.EMAIL_DOMAIN ?? "swiftee.co.uk",
    // Optional shared secret; when set, inbound webhooks must pass ?token=.
    inboundToken: process.env.EMAIL_INBOUND_TOKEN ?? "",
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
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  // In production the API also serves the built web app (single origin).
  get serveWeb() {
    return this.isProd || process.env.SERVE_WEB === "true";
  },
};
