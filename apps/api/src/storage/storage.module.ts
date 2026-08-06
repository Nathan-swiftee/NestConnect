import { Module } from "@nestjs/common";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { StorageService } from "./storage.service";

/** Media storage + the authed streaming endpoint. StorageService/MediaService
 *  are exported for the channel gateways to store inbound media. */
@Module({
  controllers: [MediaController],
  providers: [StorageService, MediaService],
  exports: [StorageService, MediaService],
})
export class StorageModule {}
