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
import { Public } from "../../auth/public.decorator";
import { Store } from "../../data/store";
import { META_APP_SECRET_KEY } from "../meta/meta-oauth.service";
import { WhatsAppService, type WhatsAppWebhookBody } from "./whatsapp.service";

function verifySignature(raw: Buffer | undefined, appSecret: string, header?: string): boolean {
  if (!raw || !header) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** First phone_number_id in the payload — used only to pick which app secret to
 *  verify against (never trusted on its own; a wrong id just fails the HMAC). */
function firstPhoneNumberId(body: WhatsAppWebhookBody): string | undefined {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return undefined;
}

@Controller("channels/whatsapp")
export class WhatsAppController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly store: Store,
  ) {}

  /** Meta webhook verification handshake (GET). */
  @Public()
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
  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Body() body: WhatsAppWebhookBody) {
    const phoneNumberId = firstPhoneNumberId(body);
    // Verify against the app secret that owns this number: the connected inbox's
    // per-org Meta secret when configured, otherwise the global env secret. This
    // stops a single global secret from standing in for a per-integration one.
    const secret = await this.resolveAppSecret(phoneNumberId);

    if (secret) {
      const sig = req.header("x-hub-signature-256") ?? undefined;
      if (!verifySignature(req.rawBody, secret, sig)) {
        await this.store.recordWebhookDiagnostic({
          channel: "whatsapp",
          kind: "bad_signature",
          reference: phoneNumberId,
          detail: "X-Hub-Signature-256 verification failed",
        });
        throw new UnauthorizedException("Invalid WhatsApp signature");
      }
    } else if (env.isProd) {
      // No secret available to verify with — never trust unsigned traffic in prod.
      await this.store.recordWebhookDiagnostic({
        channel: "whatsapp",
        kind: "bad_signature",
        reference: phoneNumberId,
        detail: "No app secret configured to verify the webhook signature",
      });
      throw new UnauthorizedException(
        "WhatsApp signature verification required in production (configure the Meta app secret)",
      );
    }
    // Dev with no secret configured stays open so the simulate tools work.
    return this.whatsapp.handleWebhook(body);
  }

  /** The Meta app secret to verify with: the number's org secret, else the global
   *  env secret, else none. */
  private async resolveAppSecret(phoneNumberId?: string): Promise<string | undefined> {
    if (phoneNumberId) {
      const inbox = await this.store.getInboxByWhatsAppPhoneId(phoneNumberId);
      if (inbox) {
        const orgSecret = (await this.store.getAppSetting(inbox.orgId, META_APP_SECRET_KEY))?.trim();
        if (orgSecret) return orgSecret;
      }
    }
    return env.whatsapp.appSecret || undefined;
  }
}
