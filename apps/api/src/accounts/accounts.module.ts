import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { AccountStore } from "./account.store";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { MemoryAccountStore } from "./memory-account.store";
import { PrismaAccountStore } from "./prisma-account.store";

/** Organisations (customer accounts) and their knowledge. See docs/organisations.md. */
@Module({
  controllers: [AccountsController],
  providers: [
    { provide: AccountStore, useClass: env.usingDatabase ? PrismaAccountStore : MemoryAccountStore },
    AccountsService,
  ],
  exports: [AccountsService],
})
export class AccountsModule {}
