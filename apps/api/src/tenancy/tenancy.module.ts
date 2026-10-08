import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TenantContext } from "./tenant-context";
import { TenantInterceptor } from "./tenant.interceptor";

// Global so the realtime gateway, ingest and every service can read the bound
// workspace without threading it through each module. The interceptor is what
// binds it, for every HTTP request and socket message.
@Global()
@Module({
  providers: [TenantContext, { provide: APP_INTERCEPTOR, useClass: TenantInterceptor }],
  exports: [TenantContext],
})
export class TenancyModule {}
