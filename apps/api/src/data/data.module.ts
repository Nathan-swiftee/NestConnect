import { Global, Module, type Provider } from "@nestjs/common";
import { env } from "../config/env";
import { Store } from "./store";
import { MemoryStore } from "./memory.store";
import { PrismaService } from "./prisma.service";
import { PrismaStore } from "./prisma.store";

// Choose the store implementation once, by configuration. Services depend only
// on the abstract `Store`, so this is the single place persistence is decided.
const providers: Provider[] = env.usingDatabase
  ? [PrismaService, { provide: Store, useClass: PrismaStore }]
  : [{ provide: Store, useClass: MemoryStore }];

@Global()
@Module({
  providers,
  exports: [Store],
})
export class DataModule {}
