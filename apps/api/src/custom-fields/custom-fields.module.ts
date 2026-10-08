import { Module } from "@nestjs/common";
import { CustomFieldsController } from "./custom-fields.controller";
import { AiModule } from "../ai/ai.module";

/** Custom fields: org-level definitions, and the values on contacts and
 *  conversations. No service of its own — the work is all in the store, which
 *  is where the search that reads these values also lives. */
@Module({ imports: [AiModule], controllers: [CustomFieldsController] })
export class CustomFieldsModule {}
