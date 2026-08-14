import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
} from "@nestjs/common";
import {
  sendBroadcastInputSchema,
  type BroadcastResult,
  type SendBroadcastInput,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { Store } from "../data/store";
import { BroadcastService } from "./broadcast.service";

/**
 * WhatsApp broadcasts — send an approved template to many recipients at once.
 * Manager/admin only: it reaches many customers in one action and spends the
 * business's messaging quota.
 */
@Controller("whatsapp/broadcast")
export class BroadcastController {
  constructor(
    private readonly broadcast: BroadcastService,
    private readonly store: Store,
  ) {}

  @Post()
  async send(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(sendBroadcastInputSchema)) body: SendBroadcastInput,
  ): Promise<BroadcastResult> {
    await this.requireManager(userId);
    return this.broadcast.send(body);
  }

  private async requireManager(userId: string): Promise<void> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can send broadcasts");
    }
  }
}
