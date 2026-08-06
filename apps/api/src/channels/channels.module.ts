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
import { GoogleOAuthService } from "./google/google-oauth.service";
import { GoogleController } from "./google/google.controller";
import { GmailProvider } from "./google/gmail.provider";
import { GmailSyncService } from "./google/gmail-sync.service";
import { IntegrationsController } from "../settings/integrations.controller";

@Module({
  imports: [RealtimeModule],
  controllers: [
    WhatsAppController,
    EmailController,
    GroupsController,
    GoogleController,
    IntegrationsController,
  ],
  providers: [
    WhatsAppCloudProvider,
    WhatsAppGroupsProvider,
    EmailProvider,
    GmailProvider,
    {
      provide: CHANNEL_PROVIDERS,
      useFactory: (
        wa: WhatsAppCloudProvider,
        email: EmailProvider,
        gmailProvider: GmailProvider,
      ) => [wa, gmailProvider, email],
      inject: [WhatsAppCloudProvider, EmailProvider, GmailProvider],
    },
    RoutingService,
    IngestService,
    WhatsAppService,
    EmailService,
    GroupsService,
    GoogleOAuthService,
    GmailSyncService,
    ChannelDispatcher,
  ],
  exports: [ChannelDispatcher],
})
export class ChannelsModule {}
