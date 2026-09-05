import { Module } from "@nestjs/common";
import { BusinessProfileController } from "./business-profile.controller";
import { BusinessProfileService } from "./business-profile.service";
import { BroadcastController } from "./broadcast.controller";
import { BroadcastService } from "./broadcast.service";
import { WhatsAppRegistrationController } from "./whatsapp-registration.controller";
import { WhatsAppRegistrationService } from "./whatsapp-registration.service";

/**
 * WhatsApp management features that sit alongside the messaging channel: the
 * public business profile, broadcasts and Cloud API phone-number registration.
 * They call Meta's Graph API directly with a number's own credentials (resolved
 * per inbox), so they don't belong in the send/receive pipeline of
 * ChannelsModule.
 */
@Module({
  controllers: [BusinessProfileController, BroadcastController, WhatsAppRegistrationController],
  providers: [BusinessProfileService, BroadcastService, WhatsAppRegistrationService],
})
export class WhatsAppManagementModule {}
