import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [ContactsController],
})
export class ContactsModule {}
