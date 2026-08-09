import { Module } from "@nestjs/common";
import { WorkspaceController } from "./workspace.controller";

// The Mailer used for invites comes from the global MailModule.
@Module({
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
