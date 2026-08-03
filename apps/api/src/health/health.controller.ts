import { Controller, Get } from "@nestjs/common";
import { env } from "../config/env";
import { Public } from "../auth/public.decorator";

@Controller("health")
export class HealthController {
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
}
