import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { WhatsAppService, type WhatsAppWebhookBody } from "./whatsapp.service";

function verifySignature(raw: Buffer | undefined, appSecret: string, header?: string): boolean {
  if (!raw || !header) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Controller("channels/whatsapp")
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  /** Meta webhook verification handshake (GET). */
  @Get("webhook")
  verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): string {
    if (mode === "subscribe" && token && token === env.whatsapp.verifyToken) {
      return challenge ?? "";
    }
    throw new ForbiddenException("WhatsApp webhook verification failed");
  }

  /** Inbound messages + delivery statuses (POST). */
  @Post("webhook")
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Body() body: WhatsAppWebhookBody) {
    if (env.whatsapp.appSecret) {
      const sig = req.header("x-hub-signature-256") ?? undefined;
      if (!verifySignature(req.rawBody, env.whatsapp.appSecret, sig)) {
        throw new UnauthorizedException("Invalid WhatsApp signature");
      }
    }
    return this.whatsapp.handleWebhook(body);
  }
}
