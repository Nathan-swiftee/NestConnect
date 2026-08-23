import { BadRequestException, Body, Controller, NotFoundException, Post, ServiceUnavailableException } from "@nestjs/common";
import { polishDraftInputSchema, type PolishDraftInput, type PolishDraftResult } from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { AiService, PolishUnavailableError } from "./ai.service";

/** AI assist for the composer. Any signed-in agent can polish their own draft —
 *  it reads nothing and writes nothing, so it isn't manager-gated like the
 *  credentials that power it. */
@Controller("ai")
export class AiController {
  constructor(
    private readonly store: Store,
    private readonly ai: AiService,
  ) {}

  @Post("polish")
  async polish(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(polishDraftInputSchema)) body: PolishDraftInput,
  ): Promise<PolishDraftResult> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    try {
      return await this.ai.polish(me.orgId, body.text, { channel: body.channel, internal: body.internal });
    } catch (err) {
      if (err instanceof PolishUnavailableError) {
        // 400 for "you haven't set this up", 503 for "the upstream is unhappy" —
        // the composer shows the message either way.
        throw err.reason === "not_configured"
          ? new BadRequestException(err.message)
          : new ServiceUnavailableException(err.message);
      }
      throw err;
    }
  }
}
