import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  requestWhatsAppObaInputSchema,
  updateWhatsAppBusinessProfileInputSchema,
  type RequestWhatsAppObaInput,
  type UpdateWhatsAppBusinessProfileInput,
  type WhatsAppBusinessProfile,
  type WhatsAppObaStatus,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { Store } from "../data/store";
import { BusinessProfileService } from "./business-profile.service";

/**
 * A WhatsApp number's public business profile. Reading and editing are
 * manager/admin only — it's the business's own storefront card, changed rarely
 * and workspace-wide, not a per-conversation action.
 */
@Controller("whatsapp/business-profile")
export class BusinessProfileController {
  constructor(
    private readonly profiles: BusinessProfileService,
    private readonly store: Store,
  ) {}

  @Get(":inboxId")
  async get(
    @CurrentUserId() userId: string,
    @Param("inboxId") inboxId: string,
  ): Promise<WhatsAppBusinessProfile> {
    await this.requireManager(userId);
    return this.profiles.get(inboxId);
  }

  @Patch(":inboxId")
  async update(
    @CurrentUserId() userId: string,
    @Param("inboxId") inboxId: string,
    @Body(new ZodValidationPipe(updateWhatsAppBusinessProfileInputSchema))
    body: UpdateWhatsAppBusinessProfileInput,
  ): Promise<WhatsAppBusinessProfile> {
    await this.requireManager(userId);
    return this.profiles.update(inboxId, body);
  }

  /** Upload/replace the number's public profile photo (JPG/PNG). */
  @Post(":inboxId/photo")
  @UseInterceptors(FileInterceptor("file"))
  async setPhoto(
    @CurrentUserId() userId: string,
    @Param("inboxId") inboxId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname?: string } | undefined,
  ): Promise<WhatsAppBusinessProfile> {
    await this.requireManager(userId);
    if (!file) throw new BadRequestException("No image received.");
    return this.profiles.setPhoto(inboxId, file);
  }

  /** The number's Official Business Account (verified badge) status, read live from Meta. */
  @Get(":inboxId/oba")
  async oba(@CurrentUserId() userId: string, @Param("inboxId") inboxId: string): Promise<WhatsAppObaStatus> {
    await this.requireManager(userId);
    return this.profiles.obaStatus(inboxId);
  }

  /** Apply for the badge. Meta reviews it; the status says how it's going. */
  @Post(":inboxId/oba")
  async requestOba(
    @CurrentUserId() userId: string,
    @Param("inboxId") inboxId: string,
    @Body(new ZodValidationPipe(requestWhatsAppObaInputSchema)) body: RequestWhatsAppObaInput,
  ): Promise<WhatsAppObaStatus> {
    await this.requireManager(userId);
    return this.profiles.requestOba(inboxId, body);
  }

  private async requireManager(userId: string): Promise<void> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can manage the business profile");
    }
  }
}
