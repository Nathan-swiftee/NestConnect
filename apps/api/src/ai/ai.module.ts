import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { ConversationSubjectService } from "./conversation-subject.service";
import { RealtimeModule } from "../realtime/realtime.module";

/** AI assist (Claude). Credentials live in AppSettings and are read per call,
 *  so switching the key or model in Settings takes effect without a restart. */
@Module({
  imports: [RealtimeModule],
  controllers: [AiController],
  providers: [AiService, ConversationSubjectService],
  exports: [AiService, ConversationSubjectService],
})
export class AiModule {}
