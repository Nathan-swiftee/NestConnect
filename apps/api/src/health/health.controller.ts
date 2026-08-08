import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { env } from "../config/env";
import { Public } from "../auth/public.decorator";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness — fast, always ok while the process is up (platform probe). */
  @Public()
  @Get()
  check() {
    return {
      status: "ok",
      service: "ding-api",
      dataSource: env.usingDatabase ? "postgres" : "fixtures",
      realtime: env.usingRedis ? "redis" : "single-node",
      time: new Date().toISOString(),
    };
  }

  /** Readiness — 503 when a required dependency (Postgres/Redis) is down. */
  @Public()
  @Get("ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.readiness();
    if (!result.ok) res.status(503);
    return result;
  }
}
