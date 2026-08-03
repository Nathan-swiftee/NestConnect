import { Body, Controller, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { env } from "../../config/env";
import { EmailService, type EmailWebhookBody } from "./email.service";

@Controller("channels/email")
export class EmailController {
  constructor(private readonly email: EmailService) {}

  /** Inbound email (e.g. Postmark inbound webhook). */
  @Post("webhook")
  @HttpCode(200)
  async receive(@Body() body: EmailWebhookBody, @Query("token") token?: string) {
    if (env.email.inboundToken && token !== env.email.inboundToken) {
      throw new UnauthorizedException("Invalid inbound email token");
    }
    return this.email.handleWebhook(body);
  }
}
