import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { CHANNEL_PROVIDERS } from "./channel-provider";
import { ChannelDispatcher } from "./channel-dispatcher";
import { IngestService } from "./ingest.service";
import { RoutingService } from "./routing.service";
import { WhatsAppCloudProvider } from "./whatsapp/whatsapp.provider";
import { WhatsAppController } from "./whatsapp/whatsapp.controller";
import { WhatsAppService } from "./whatsapp/whatsapp.service";

@Module({
  imports: [RealtimeModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppCloudProvider,
    { provide: CHANNEL_PROVIDERS, useFactory: (wa: WhatsAppCloudProvider) => [wa], inject: [WhatsAppCloudProvider] },
    RoutingService,
    IngestService,
    WhatsAppService,
    ChannelDispatcher,
  ],
  exports: [ChannelDispatcher],
})
export class ChannelsModule {}
