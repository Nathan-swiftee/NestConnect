import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { DevicesController } from "./devices.controller";
import { ExpoPushProvider } from "./expo-push.provider";
import { PushProvider } from "./push.provider";
import { PushService } from "./push.service";

/**
 * Push notifications: the device registry, the delivery policy, and the
 * provider that reaches the phone.
 *
 * `PushProvider` is bound by token, exactly as `Store` and `OutboundQueue` are,
 * so replacing Expo with direct FCM + APNs is one line here — everything that
 * decides *whether* to notify someone is written against the interface.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [DevicesController],
  providers: [{ provide: PushProvider, useClass: ExpoPushProvider }, PushService],
  exports: [PushService],
})
export class PushModule {}
