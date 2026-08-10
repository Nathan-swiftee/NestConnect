import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { StorageModule } from "../storage/storage.module";
import { CHANNEL_PROVIDERS } from "./channel-provider";
import { ChannelDispatcher } from "./channel-dispatcher";
import { OutboundDeliveryService } from "./outbound-delivery.service";
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
import { MetaOAuthService } from "./meta/meta-oauth.service";
import { MetaController } from "./meta/meta.controller";
import { DiagnosticsController } from "./diagnostics.controller";
import { IntegrationsController } from "../settings/integrations.controller";

@Module({
  imports: [RealtimeModule, StorageModule],
  controllers: [
    WhatsAppController,
    EmailController,
    GroupsController,
    GoogleController,
    MetaController,
    DiagnosticsController,
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
    MetaOAuthService,
    ChannelDispatcher,
    OutboundDeliveryService,
  ],
  exports: [ChannelDispatcher, OutboundDeliveryService, GmailSyncService, MetaOAuthService],
})
export class ChannelsModule {}
