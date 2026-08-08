import { Body, Controller, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { env } from "../../config/env";
import { Public } from "../../auth/public.decorator";
import { EmailService, type EmailWebhookBody } from "./email.service";

@SkipThrottle() // inbound email webhook — bursts; guarded by the shared token
@Controller("channels/email")
export class EmailController {
  constructor(private readonly email: EmailService) {}

  /** Inbound email (e.g. Postmark inbound webhook). */
  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(@Body() body: EmailWebhookBody, @Query("token") token?: string) {
    // Require the shared secret in production (fail closed); enforce it whenever
    // it's configured. No inbound email is wired until this is set.
    if (env.isProd && !env.email.inboundToken) {
      throw new UnauthorizedException("Inbound email token required in production (set EMAIL_INBOUND_TOKEN)");
    }
    if (env.email.inboundToken && token !== env.email.inboundToken) {
      throw new UnauthorizedException("Invalid inbound email token");
    }
    return this.email.handleWebhook(body);
  }
}
