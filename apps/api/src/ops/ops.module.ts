import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { NotificationsModule } from "../notifications/notifications.module";
import { MemoryOpsStore } from "./memory-ops.store";
import { OpsController } from "./ops.controller";
import { OpsSeedService } from "./ops-seed.service";
import { OpsService } from "./ops.service";
import { OpsStore } from "./ops.store";
import { PrismaOpsStore } from "./prisma-ops.store";

/** Business Ops — the workspace's own SOPs, by team. See docs/business-ops.md. */
@Module({
  imports: [NotificationsModule],
  controllers: [OpsController],
  providers: [{ provide: OpsStore, useClass: env.usingDatabase ? PrismaOpsStore : MemoryOpsStore }, OpsService, OpsSeedService],
})
export class OpsModule {}
