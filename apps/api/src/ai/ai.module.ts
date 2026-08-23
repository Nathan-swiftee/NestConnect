import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

/** AI assist (Claude). Credentials live in AppSettings and are read per call,
 *  so switching the key or model in Settings takes effect without a restart. */
@Module({
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
