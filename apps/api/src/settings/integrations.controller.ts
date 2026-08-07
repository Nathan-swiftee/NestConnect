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
  GOOGLE_PUBSUB_TOPIC_KEY,
} from "../channels/google/google-oauth.service";
import { googlePushEndpoint, googleRedirectUri } from "../channels/google/redirect-uri";
import {
  MetaOAuthService,
  META_APP_ID_KEY,
  META_APP_SECRET_KEY,
  META_CONFIG_ID_KEY,
} from "../channels/meta/meta-oauth.service";
import { metaRedirectUri } from "../channels/meta/redirect-uri";
import {
  r2PublicSettings,
  R2_ACCESS_KEY_ID_KEY,
  R2_ACCOUNT_ID_KEY,
  R2_BUCKET_KEY,
  R2_SECRET_ACCESS_KEY_KEY,
} from "../storage/r2-config";

/** App-level integration settings (Settings › Setup). Currently: the org's
 *  Google OAuth app credentials that power the "Connect with Google" flow. */
@Controller("settings/integrations")
export class IntegrationsController {
  constructor(
    private readonly store: Store,
    private readonly google: GoogleOAuthService,
    private readonly meta: MetaOAuthService,
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
    // The Pub/Sub topic is written whenever supplied, including empty to clear it.
    if (body.googlePubsubTopic !== undefined) {
      await this.store.setAppSetting(me.orgId, GOOGLE_PUBSUB_TOPIC_KEY, body.googlePubsubTopic.trim());
    }
    // Meta (WhatsApp) app credentials.
    const metaAppId = body.metaAppId?.trim();
    if (metaAppId) await this.store.setAppSetting(me.orgId, META_APP_ID_KEY, metaAppId);
    const metaAppSecret = body.metaAppSecret?.trim();
    if (metaAppSecret) await this.store.setAppSetting(me.orgId, META_APP_SECRET_KEY, metaAppSecret);
    if (body.metaConfigId !== undefined) {
      await this.store.setAppSetting(me.orgId, META_CONFIG_ID_KEY, body.metaConfigId.trim());
    }
    // Cloudflare R2 storage. Account id + bucket write on any change (empty
    // clears, dropping back to disk); the keys write only when supplied.
    if (body.r2AccountId !== undefined) {
      await this.store.setAppSetting(me.orgId, R2_ACCOUNT_ID_KEY, body.r2AccountId.trim());
    }
    if (body.r2Bucket !== undefined) {
      await this.store.setAppSetting(me.orgId, R2_BUCKET_KEY, body.r2Bucket.trim());
    }
    const r2AccessKeyId = body.r2AccessKeyId?.trim();
    if (r2AccessKeyId) await this.store.setAppSetting(me.orgId, R2_ACCESS_KEY_ID_KEY, r2AccessKeyId);
    const r2Secret = body.r2SecretAccessKey?.trim();
    if (r2Secret) await this.store.setAppSetting(me.orgId, R2_SECRET_ACCESS_KEY_KEY, r2Secret);
    return this.snapshot(me.orgId, req);
  }

  /** Build the GET/PATCH response. Secrets are never included. */
  private async snapshot(orgId: string, req: Request): Promise<IntegrationSettings> {
    const [clientId, googleConfigured, pubsubTopic, metaAppId, metaConfigured, metaConfigId, storage] =
      await Promise.all([
        this.google.clientId(orgId),
        this.google.configured(orgId),
        this.store.getAppSetting(orgId, GOOGLE_PUBSUB_TOPIC_KEY),
        this.meta.appId(orgId),
        this.meta.configured(orgId),
        this.meta.configId(orgId),
        r2PublicSettings(this.store, orgId),
      ]);
    return {
      google: {
        clientId,
        configured: googleConfigured,
        redirectUri: googleRedirectUri(req),
        pubsubTopic: pubsubTopic ?? "",
        pushEndpoint: googlePushEndpoint(req),
      },
      meta: {
        appId: metaAppId,
        configured: metaConfigured,
        configId: metaConfigId,
        redirectUri: metaRedirectUri(req),
      },
      storage,
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
