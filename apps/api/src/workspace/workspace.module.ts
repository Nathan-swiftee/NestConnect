import { Module } from "@nestjs/common";
import { WorkspaceController } from "./workspace.controller";
import { ChannelsModule } from "../channels/channels.module";

// The Mailer used for invites comes from the global MailModule. ChannelsModule
// provides MetaOAuthService, used to subscribe a WhatsApp number's webhook.
@Module({
  imports: [ChannelsModule],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
