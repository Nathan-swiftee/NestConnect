import { Controller, Get } from "@nestjs/common";
import { env } from "../config/env";

@Controller("health")
export class HealthController {
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
