import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller";

/** Every workspace on the platform, for its owners. */
@Module({ controllers: [PlatformController] })
export class PlatformModule {}
