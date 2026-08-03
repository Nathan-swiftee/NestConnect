import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { ChannelsModule } from "../channels/channels.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [RealtimeModule, ChannelsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
