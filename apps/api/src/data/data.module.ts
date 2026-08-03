import { Global, Module } from "@nestjs/common";
import { Store } from "./store";

/**
 * Provides the shared data store app-wide. Swapping the in-memory Store for a
 * Prisma-backed one later is a change confined to this module.
 */
@Global()
@Module({
  providers: [Store],
  exports: [Store],
})
export class DataModule {}
