import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  whatsAppRegisterInputSchema,
  type WhatsAppNumberState,
  type WhatsAppRegisterInput,
  type WhatsAppRegisterResult,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { Store } from "../data/store";
import { WhatsAppRegistrationService } from "./whatsapp-registration.service";

/**
 * Registering a WhatsApp number on the Cloud API.
 *
 * Four segments deep (`channels/:channelId/whatsapp/…`) so it cannot collide
 * with the three-segment webhook routes on `channels/whatsapp`.
 *
 * The browser sends one thing — a 6-digit PIN — and never a credential: the
 * Phone number ID and access token are read from the channel's own stored
 * config here, on the server. That is not only tidier, it is the requirement:
 * `accessToken` is excluded from `PUBLIC_CHANNEL_KEYS`, so the settings screen
 * has never held it and must not start.
 */
@Controller("channels")
export class WhatsAppRegistrationController {
  constructor(
    private readonly registration: WhatsAppRegistrationService,
    private readonly store: Store,
  ) {}

  /** What Meta says about this number right now — asked of Meta, not guessed
   *  from whether we happen to have credentials saved. */
  @Get(":channelId/whatsapp/status")
  async status(
    @CurrentUserId() userId: string,
    @Param("channelId") channelId: string,
  ): Promise<WhatsAppNumberState> {
    await this.requireManager(userId);
    return this.registration.stateFor(channelId);
  }

  /**
   * `POST /{phone-number-id}/register` with the number's two-step verification
   * PIN — from here, never from the browser.
   *
   * Always 200 with a result the UI renders, including for a failed attempt: a
   * wrong PIN is an outcome an admin needs to read and try again from, not an
   * exception. Genuine faults (not a manager, no such channel) still throw.
   */
  @Post(":channelId/whatsapp/register")
  // Nothing is created here, so 201 would be a small lie — and a failed
  // registration coming back as "201 Created" is a confusing thing to read in
  // a network tab.
  @HttpCode(200)
  async register(
    @CurrentUserId() userId: string,
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(whatsAppRegisterInputSchema)) body: WhatsAppRegisterInput,
  ): Promise<WhatsAppRegisterResult> {
    await this.requireManager(userId);
    return this.registration.register(channelId, body.pin);
  }

  private async requireManager(userId: string): Promise<void> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can register a WhatsApp number");
    }
  }
}
