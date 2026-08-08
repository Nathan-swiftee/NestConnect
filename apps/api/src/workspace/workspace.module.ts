import { Module } from "@nestjs/common";
import { WorkspaceController } from "./workspace.controller";
import { InviteMailer } from "../auth/invite-mailer";

@Module({
  controllers: [WorkspaceController],
  providers: [InviteMailer],
})
export class WorkspaceModule {}
