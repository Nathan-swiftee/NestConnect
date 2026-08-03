import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { DataModule } from "./data/data.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ChannelsModule } from "./channels/channels.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { HealthController } from "./health/health.controller";
import { AuthMiddleware } from "./auth/auth.middleware";

@Module({
  imports: [DataModule, RealtimeModule, ChannelsModule, ConversationsModule, WorkspaceModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes("*");
  }
}
