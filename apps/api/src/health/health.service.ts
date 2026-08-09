import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { env } from "../config/env";
import { Store } from "../data/store";
import { OutboundQueue } from "../queue/outbound-queue";

/** Reject the ping if the broker is wedged, so readiness never hangs. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref?.()),
  ]);
}

/**
 * Readiness checks for the process's real dependencies: Postgres, Redis, the
 * outbound queue, and the (config) state of the channel providers. Deliberately
 * lean — a couple of cheap pings, no observability stack.
 */
@Injectable()
export class HealthService {
  private redis?: Redis;

  constructor(
    private readonly store: Store,
    private readonly queue: OutboundQueue,
  ) {}

  private async pingRedis(): Promise<"ok" | "down"> {
    if (!env.usingRedis) return "ok"; // not configured → not required
    try {
      if (!this.redis) {
        this.redis = new Redis(env.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: () => null,
        });
      }
      if (this.redis.status === "wait" || this.redis.status === "end") {
        await withTimeout(this.redis.connect(), 1500);
      }
      const pong = await withTimeout(this.redis.ping(), 1500);
      return pong === "PONG" ? "ok" : "down";
    } catch {
      return "down";
    }
  }

  async readiness(): Promise<{ ok: boolean; checks: Record<string, unknown>; time: string }> {
    const [dbOk, redis, queue] = await Promise.all([
      this.store.healthCheck().catch(() => false),
      this.pingRedis(),
      this.queue.getStats().catch(() => ({ error: "unavailable" })),
    ]);
    const database = env.usingDatabase ? (dbOk ? "ok" : "down") : "disabled";
    // Only configured dependencies are required for readiness.
    const required = [database, redis].filter((s) => s !== "disabled");
    const ok = required.every((s) => s === "ok");
    return {
      ok,
      checks: {
        database,
        redis: env.usingRedis ? redis : "disabled",
        queue,
        providers: {
          whatsapp: env.whatsappLive ? "live" : "mock",
          email: env.emailLive ? "live" : "mock",
        },
        secretsEncrypted: Boolean(env.secretKey),
      },
      time: new Date().toISOString(),
    };
  }
}
