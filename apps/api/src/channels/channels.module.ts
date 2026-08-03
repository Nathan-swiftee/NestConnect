import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { CHANNEL_PROVIDERS } from "./channel-provider";
import { ChannelDispatcher } from "./channel-dispatcher";
import { IngestService } from "./ingest.service";
import { RoutingService } from "./routing.service";
import { WhatsAppCloudProvider } from "./whatsapp/whatsapp.provider";
import { WhatsAppGroupsProvider } from "./whatsapp/whatsapp-groups.provider";
import { WhatsAppController } from "./whatsapp/whatsapp.controller";
import { WhatsAppService } from "./whatsapp/whatsapp.service";
import { EmailProvider } from "./email/email.provider";
import { EmailController } from "./email/email.controller";
import { EmailService } from "./email/email.service";
import { GroupsService } from "./groups/groups.service";
import { GroupsController } from "./groups/groups.controller";

@Module({
  imports: [RealtimeModule],
  controllers: [WhatsAppController, EmailController, GroupsController],
  providers: [
    WhatsAppCloudProvider,
    WhatsAppGroupsProvider,
    EmailProvider,
    {
      provide: CHANNEL_PROVIDERS,
      useFactory: (wa: WhatsAppCloudProvider, email: EmailProvider) => [wa, email],
      inject: [WhatsAppCloudProvider, EmailProvider],
    },
    RoutingService,
    IngestService,
    WhatsAppService,
    EmailService,
    GroupsService,
    ChannelDispatcher,
  ],
  exports: [ChannelDispatcher],
})
export class ChannelsModule {}
