import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [RealtimeModule, AccountsModule],
  controllers: [ContactsController],
})
export class ContactsModule {}
