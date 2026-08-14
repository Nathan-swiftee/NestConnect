import { Module } from "@nestjs/common";
import { BusinessProfileController } from "./business-profile.controller";
import { BusinessProfileService } from "./business-profile.service";
import { BroadcastController } from "./broadcast.controller";
import { BroadcastService } from "./broadcast.service";

/**
 * WhatsApp management features that sit alongside the messaging channel: the
 * public business profile and broadcasts. They call Meta's Graph API directly
 * with a number's own credentials (resolved per inbox), so they don't belong in
 * the send/receive pipeline of ChannelsModule.
 */
@Module({
  controllers: [BusinessProfileController, BroadcastController],
  providers: [BusinessProfileService, BroadcastService],
})
export class WhatsAppManagementModule {}
