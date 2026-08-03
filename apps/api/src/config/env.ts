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
  port: Number(process.env.API_PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  get usingDatabase() {
    return this.databaseUrl.length > 0;
  },
  get usingRedis() {
    return this.redisUrl.length > 0;
  },
};
