import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { ChannelsModule } from "../channels/channels.module";
import { QueueModule } from "../queue/queue.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PushModule } from "../push/push.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [RealtimeModule, ChannelsModule, QueueModule, NotificationsModule, PushModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
