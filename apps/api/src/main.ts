import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  app.enableCors({ origin: env.corsOrigin, credentials: true });
  // REST lives under /api; /health stays at the root for platform probes.
  app.setGlobalPrefix("api", { exclude: ["health"] });

  await app.listen(env.port);

  const log = new Logger("Bootstrap");
  log.log(`Ding API listening on http://localhost:${env.port}`);
  log.log(`  data source : ${env.usingDatabase ? "postgres" : "in-memory fixtures"}`);
  log.log(`  realtime    : ${env.usingRedis ? "socket.io + redis adapter" : "socket.io (single node)"}`);
  log.log(`  cors origin : ${env.corsOrigin}`);
}

void bootstrap();
