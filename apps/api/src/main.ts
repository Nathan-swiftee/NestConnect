import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap() {
  // rawBody:true keeps the raw request buffer so we can verify the WhatsApp
  // X-Hub-Signature-256 HMAC on inbound webhooks.
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });

  app.enableCors({ origin: env.corsOrigin, credentials: true });
  // REST lives under /api; /health stays at the root for platform probes.
  app.setGlobalPrefix("api", { exclude: ["health"] });

  await app.listen(env.port);

  const log = new Logger("Bootstrap");
  log.log(`Ding API listening on http://localhost:${env.port}`);
  log.log(`  data source : ${env.usingDatabase ? "postgres" : "in-memory fixtures"}`);
  log.log(`  realtime    : ${env.usingRedis ? "socket.io + redis adapter" : "socket.io (single node)"}`);
  log.log(`  whatsapp    : ${env.whatsappLive ? "live (cloud api)" : "mock provider"}`);
  log.log(`  cors origin : ${env.corsOrigin}`);
}

void bootstrap();
