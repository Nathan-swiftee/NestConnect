import { Module } from "@nestjs/common";
import { DataModule } from "./data/data.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [DataModule, RealtimeModule, ConversationsModule, WorkspaceModule],
  controllers: [HealthController],
})
export class AppModule {}
