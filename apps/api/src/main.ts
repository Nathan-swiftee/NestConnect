import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { Store } from "./data/store";
import { env, assertProdSecrets } from "./config/env";
import { StructuredLogger } from "./common/structured-logger";

// Last-resort process guards: log and keep serving on an unhandled rejection;
// on a truly uncaught exception the process is in an unknown state — log and let
// the platform restart it (graceful shutdown hooks still run).
function installProcessGuards(logger: Logger): void {
  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}

async function bootstrap() {
  // Refuse to boot production on insecure default secrets (fail closed).
  assertProdSecrets(new Logger("Bootstrap"));

  // rawBody:true keeps the raw request buffer so we can verify the WhatsApp
  // X-Hub-Signature-256 HMAC on inbound webhooks. Structured JSON logs in prod.
  const app = await NestFactory.create(AppModule, {
    cors: false,
    rawBody: true,
    logger: new StructuredLogger(),
  });
  installProcessGuards(new Logger("Process"));

  // Security headers. CSP is left to the app (it serves the SPA and renders
  // email in a sandboxed iframe with its own strict CSP), so helmet's default
  // CSP is disabled to avoid breaking those; the rest of the headers stay on.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Trust the platform proxy so req.ip is the real client (rate limiting keys on
  // it). Set to the number of proxy hops in front of the app (Railway ≈ 1).
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(cookieParser());
  // The NestChat widget runs in an iframe on the customer's own website, so its
  // public routes have to answer any origin. They are opened up here, ahead of
  // the app's own CORS, rather than by loosening that policy: the agent-facing
  // API is reached with a session cookie, and a reflected origin plus
  // credentials on *those* routes would let any website act as a signed-in user.
  // These routes carry no cookie (the visitor's bearer token is passed
  // explicitly), so `*` without credentials is the whole of what they need.
  app.use("/api/nestchat", (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.enableCors({ origin: env.corsOrigin, credentials: true });
  // REST lives under /api; health endpoints stay at the root for platform probes.
  app.setGlobalPrefix("api", { exclude: ["health", "health/ready"] });

  // Graceful shutdown: on SIGTERM/SIGINT, Nest runs OnModuleDestroy hooks so the
  // BullMQ worker stops taking jobs and lets in-flight deliveries drain.
  app.enableShutdownHooks();

  // One-time (idempotent) backfill: give every existing contact identity a
  // canonical normalizedValue before we serve traffic, so inbound messages match
  // existing contacts instead of forking duplicates. Never blocks boot on error.
  try {
    const { updated } = await app.get(Store).backfillIdentityNormalization();
    if (updated) new Logger("Bootstrap").log(`Normalized ${updated} contact identit${updated === 1 ? "y" : "ies"}`);
  } catch (err) {
    new Logger("Bootstrap").warn(`Identity normalization backfill skipped: ${String(err)}`);
  }

  // Consolidate any residual duplicate customers (legacy rows sharing a phone/
  // email) and apply the per-org identity uniqueness index. Idempotent — a
  // no-op once the index exists — and never blocks boot on error.
  try {
    const bl = new Logger("Bootstrap");
    const r = await app.get(Store).reconcileIdentityUniqueness();
    if (r.mergedContacts || r.collapsedIdentities)
      bl.log(`Identity dedup: merged ${r.mergedContacts} duplicate contact(s), collapsed ${r.collapsedIdentities} identity row(s)`);
    bl.log(
      r.constraintApplied
        ? `Per-org identity uniqueness: enforced${env.usingDatabase ? " (DB unique index in place)" : ""}`
        : "Per-org identity uniqueness: NOT applied — residual duplicates remain (get-or-create dedup still active)",
    );
  } catch (err) {
    new Logger("Bootstrap").warn(`Identity uniqueness reconcile skipped: ${String(err)}`);
  }

  await app.listen(env.port);

  const log = new Logger("Bootstrap");
  log.log(`Ding API listening on http://localhost:${env.port}`);
  log.log(`  data source : ${env.usingDatabase ? "postgres" : "in-memory fixtures"}`);
  log.log(`  realtime    : ${env.usingRedis ? "socket.io + redis adapter" : "socket.io (single node)"}`);
  log.log(`  whatsapp    : ${env.whatsappLive ? "live (cloud api)" : "mock provider"}`);
  log.log(`  email       : ${env.emailLive ? "live (postmark)" : "mock provider"}`);
  log.log(`  cors origin : ${env.corsOrigin}`);
}

void bootstrap();
