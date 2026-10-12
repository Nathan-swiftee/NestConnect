import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { MacroStore } from "./macro.store";
import { MacrosController } from "./macros.controller";
import { MacrosService } from "./macros.service";
import { MemoryMacroStore } from "./memory-macro.store";
import { PrismaMacroStore } from "./prisma-macro.store";

/** Macros — saved replies for the composer, by team inbox. See docs/macros.md. */
@Module({
  controllers: [MacrosController],
  providers: [{ provide: MacroStore, useClass: env.usingDatabase ? PrismaMacroStore : MemoryMacroStore }, MacrosService],
})
export class MacrosModule {}
