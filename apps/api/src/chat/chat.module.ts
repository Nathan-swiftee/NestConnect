import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { NotificationsModule } from "../notifications/notifications.module";
import { PushModule } from "../push/push.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatStore } from "./chat.store";
import { MemoryChatStore } from "./memory-chat.store";
import { PrismaChatStore } from "./prisma-chat.store";

/** Team Chat — direct messages, groups and team chats. See docs/team-chat.md. */
@Module({
  imports: [RealtimeModule, PushModule, NotificationsModule],
  controllers: [ChatController],
  providers: [{ provide: ChatStore, useClass: env.usingDatabase ? PrismaChatStore : MemoryChatStore }, ChatService],
})
export class ChatModule {}
