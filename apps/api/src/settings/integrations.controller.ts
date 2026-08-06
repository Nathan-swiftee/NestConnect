import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  updateIntegrationSettingsInputSchema,
  type IntegrationSettings,
  type UpdateIntegrationSettingsInput,
  type User,
} from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import {
  GoogleOAuthService,
  GOOGLE_CLIENT_ID_KEY,
  GOOGLE_CLIENT_SECRET_KEY,
} from "../channels/google/google-oauth.service";
import { googleRedirectUri } from "../channels/google/redirect-uri";

/** App-level integration settings (Settings › Setup). Currently: the org's
 *  Google OAuth app credentials that power the "Connect with Google" flow. */
@Controller("settings/integrations")
export class IntegrationsController {
  constructor(
    private readonly store: Store,
    private readonly google: GoogleOAuthService,
  ) {}

  @Get()
  async get(@CurrentUserId() userId: string, @Req() req: Request): Promise<IntegrationSettings> {
    const me = await this.requireUser(userId);
    return this.snapshot(me.orgId, req);
  }

  @Patch()
  async update(
    @CurrentUserId() userId: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(updateIntegrationSettingsInputSchema))
    body: UpdateIntegrationSettingsInput,
  ): Promise<IntegrationSettings> {
    const me = await this.requireManager(userId);
    // Only overwrite a field when a non-empty value is supplied — so the secret
    // can be left blank in the form to keep the stored one.
    const clientId = body.googleClientId?.trim();
    if (clientId) await this.store.setAppSetting(me.orgId, GOOGLE_CLIENT_ID_KEY, clientId);
    const clientSecret = body.googleClientSecret?.trim();
    if (clientSecret) await this.store.setAppSetting(me.orgId, GOOGLE_CLIENT_SECRET_KEY, clientSecret);
    return this.snapshot(me.orgId, req);
  }

  /** Build the GET/PATCH response. The client secret is never included. */
  private async snapshot(orgId: string, req: Request): Promise<IntegrationSettings> {
    const [clientId, configured] = await Promise.all([
      this.google.clientId(orgId),
      this.google.configured(orgId),
    ]);
    return {
      google: { clientId, configured, redirectUri: googleRedirectUri(req) },
    };
  }

  private async requireUser(userId: string): Promise<User> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    return me;
  }

  private async requireManager(userId: string): Promise<User> {
    const me = await this.requireUser(userId);
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can change settings");
    }
    return me;
  }
}
