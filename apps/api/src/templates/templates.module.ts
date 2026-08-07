import { Module } from "@nestjs/common";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

/** WhatsApp message templates: CRUD + Meta sync + the composer's picker source. */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
