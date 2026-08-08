import { Global, Module } from "@nestjs/common";
import { TenantContext } from "./tenant-context";

// Global so the realtime gateway, ingest, and future request-scoped resolution
// can share one tenant seam without threading it through every module.
@Global()
@Module({
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenancyModule {}
