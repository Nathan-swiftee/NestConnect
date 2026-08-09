import { Global, Module } from "@nestjs/common";
import { Mailer } from "./mailer.service";

/** Global so any feature (auth invites/resets, settings test-send) can inject
 *  the Mailer without wiring the module in each place. */
@Global()
@Module({
  providers: [Mailer],
  exports: [Mailer],
})
export class MailModule {}
