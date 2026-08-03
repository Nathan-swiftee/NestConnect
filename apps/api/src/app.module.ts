import { Module } from "@nestjs/common";
import { DataModule } from "./data/data.module";
import { AuthModule } from "./auth/auth.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ChannelsModule } from "./channels/channels.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [DataModule, AuthModule, RealtimeModule, ChannelsModule, ConversationsModule, WorkspaceModule],
  controllers: [HealthController],
})
export class AppModule {}
