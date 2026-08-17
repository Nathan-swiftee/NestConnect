import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TrackingController } from "./tracking.controller";

/** Public email open-tracking pixel endpoint (Store is global; Realtime for the
 *  live "Seen" broadcast). */
@Module({
  imports: [RealtimeModule],
  controllers: [TrackingController],
})
export class TrackingModule {}
