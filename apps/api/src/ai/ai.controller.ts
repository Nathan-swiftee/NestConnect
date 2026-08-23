import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { polishDraftInputSchema, type PolishDraftInput, type PolishDraftResult } from "@ding/schemas";
import { Store } from "../data/store";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUserId } from "../auth/current-user.decorator";
import { AiService, PolishUnavailableError, type PolishHistoryTurn } from "./ai.service";

/** Enough thread for the model to understand the situation, not so much that a
 *  long-running conversation blows up latency or cost on every tap. */
const HISTORY_TURNS = 12;
const HISTORY_CHARS = 600;

/** AI assist for the composer. Any signed-in agent can polish their own draft —
 *  it reads nothing and writes nothing, so it isn't manager-gated like the
 *  credentials that power it. */
@Controller("ai")
export class AiController {
  constructor(
    private readonly store: Store,
    private readonly ai: AiService,
  ) {}

  /** The models this workspace's key can use, for the Settings picker. Returns
   *  an error string rather than throwing, so the sheet can fall back to a
   *  free-text field instead of becoming a dead end. */
  @Get("models")
  async models(
    @CurrentUserId() userId: string,
  ): Promise<{ models: { id: string; name: string }[]; error?: string }> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    try {
      return { models: await this.ai.listModels(me.orgId) };
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : "Couldn't list models" };
    }
  }

  /** Run one real polish against a fixed sample and report what happened.
   *  Settings › Integrations › AI calls this so a misconfigured key or model
   *  names itself here — with Claude's own words — instead of only failing
   *  later behind the composer's Polish button. */
  @Post("test")
  async test(
    @CurrentUserId() userId: string,
  ): Promise<{ ok: boolean; model: string; sample?: string; error?: string }> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    const model = await this.ai.model(me.orgId);
    try {
      const res = await this.ai.polish(me.orgId, "hi sam sorry for the wait ur order went out this morning", {
        channel: "whatsapp",
      });
      return { ok: true, model, sample: res.text };
    } catch (err) {
      return { ok: false, model, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /** The tail of the thread, for context. Loaded here rather than accepted from
   *  the client, so what the model sees is what the conversation actually holds
   *  and belongs to the caller's org.
   *
   *  Internal notes are excluded: they're written for teammates ("customer is
   *  furious, don't promise a refund") and must never bleed into a reply. */
  private async history(conversationId: string | undefined, orgId: string): Promise<PolishHistoryTurn[]> {
    if (!conversationId) return [];
    const conv = await this.store.getConversation(conversationId);
    if (!conv || conv.orgId !== orgId) return [];
    return conv.messages
      .filter((m) => !m.internal && m.body?.trim())
      .slice(-HISTORY_TURNS)
      .map((m) => ({
        from: m.direction === "in" ? ("customer" as const) : ("agent" as const),
        text: m.body.trim().slice(0, HISTORY_CHARS),
      }));
  }

  @Post("polish")
  async polish(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(polishDraftInputSchema)) body: PolishDraftInput,
  ): Promise<PolishDraftResult> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    try {
      return await this.ai.polish(me.orgId, body.text, {
        channel: body.channel,
        internal: body.internal,
        history: await this.history(body.conversationId, me.orgId),
      });
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
