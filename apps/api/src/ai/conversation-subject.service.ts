import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { ConversationWithMessages } from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { runInTenant } from "../tenancy/tenant-scope";
import { AiService, type PolishHistoryTurn } from "./ai.service";

/** The customer messages a topic is (re)written for. A chat that opens with
 *  "Hi" gets its real subject from the second or third; after that the
 *  subject is settled and nothing more is sent to the AI. */
export const SUBJECT_TOPIC_MESSAGES = 3;
/** Most custom field values shown in front of the topic. */
const SUBJECT_MAX_FIELDS = 3;
/** Messages of context the AI is given, from the start of the thread. */
const SUBJECT_CONTEXT_MESSAGES = 8;

/**
 * Subjects for new WhatsApp and website-chat conversations.
 *
 * Neither channel has a subject of its own, so a list of them is a list of
 * names and previews. This writes one: the thread's custom field values, then
 * a short topic —
 *
 *     Order ID DG-88412 · Refund for damaged parcel
 *
 * The two halves come from different places on purpose:
 *
 *  - The field values are put in front by this service, not by the AI. They
 *    are the details an agent searches by, and a prompt edit (or a model
 *    having a bad day) must not be able to drop them. It also means they work
 *    with AI switched off, and a field set later — by an app or an agent —
 *    updates the subject at once with no AI call.
 *  - The topic is AI-written (Settings › Integrations › AI) from the
 *    customer's first few messages, rewritten on each of the first
 *    SUBJECT_TOPIC_MESSAGES so "Hi" is followed by something useful. Until the
 *    AI has spoken — or if it can't — the thread keeps its starting topic (on
 *    the chat, what the visitor picked from the menu and the page they were on).
 *
 * Only conversations created with `autoSubject` are touched: never an email,
 * whose subject is the customer's own, and never a thread from before this.
 */
@Injectable()
export class ConversationSubjectService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationSubjectService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  /** How long to wait after a customer message before asking the AI, so a
   *  burst of short messages becomes one call about all of them. */
  delayMs = 4_000;

  constructor(
    private readonly store: Store,
    private readonly ai: AiService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** A customer wrote. Schedules a topic rewrite; returns at once. */
  customerWrote(conversationId: string, orgId: string): void {
    const queued = this.pending.get(conversationId);
    if (queued) clearTimeout(queued);
    const timer = setTimeout(() => {
      this.pending.delete(conversationId);
      // Off the request that scheduled it, so the workspace is bound here.
      void runInTenant(orgId, () => this.writeTopic(conversationId)).catch((err) =>
        this.logger.warn(`Subject for ${conversationId} failed: ${String(err)}`),
      );
    }, this.delayMs);
    timer.unref?.();
    this.pending.set(conversationId, timer);
  }

  /** Ask the AI for a topic now (within the bound workspace), then recompose. */
  async writeTopic(conversationId: string): Promise<void> {
    const state = await this.store.getSubjectState(conversationId);
    if (!state?.auto) return;
    const conv = await this.store.getConversation(conversationId);
    if (!conv) return;

    const said = conv.messages.filter((m) => !m.internal && m.authorType !== "system");
    const fromCustomer = said.filter((m) => m.direction === "in").length;
    if (fromCustomer > 0 && fromCustomer <= SUBJECT_TOPIC_MESSAGES) {
      const turns: PolishHistoryTurn[] = said.slice(0, SUBJECT_CONTEXT_MESSAGES).map((m) => ({
        from: m.direction === "in" ? "customer" : "agent",
        text: m.body.trim() || "(sent an attachment)",
      }));
      const fields = await this.fieldDetails(conv);
      const topic = await this.ai.subjectTopic(conv.orgId, {
        channel: conv.channel,
        turns,
        details: fields.map((f) => `${f.label}: ${f.value}`),
      });
      if (topic) await this.store.setSubjectTopic(conversationId, topic);
    }
    await this.recompose(conversationId);
  }

  /** A conversation's custom field values changed. No AI call — the values
   *  are put in front of the topic it already has. */
  async fieldsChanged(conversationId: string): Promise<void> {
    await this.recompose(conversationId).catch((err) =>
      this.logger.warn(`Subject for ${conversationId} not updated: ${String(err)}`),
    );
  }

  /** Fields, then topic; written and broadcast only when it changed. */
  private async recompose(conversationId: string): Promise<void> {
    const state = await this.store.getSubjectState(conversationId);
    if (!state?.auto) return;
    const conv = await this.store.getConversation(conversationId);
    if (!conv) return;
    const subject = composeSubject(await this.fieldDetails(conv), state.topic);
    if (subject === (conv.subject ?? null)) return;
    const updated = await this.store.setSubject(conversationId, subject);
    if (updated) this.realtime.emitConversationUpdated(updated);
  }

  /** This conversation's custom field values with their labels, in the order
   *  the fields are arranged in Settings. Retired fields are left out. */
  private async fieldDetails(conv: ConversationWithMessages): Promise<{ label: string; value: string }[]> {
    const [defs, values] = await Promise.all([
      this.store.listCustomFields(conv.orgId),
      this.store.customFieldValues(conv.orgId, "conversation", [conv.id]),
    ]);
    const byId = new Map(defs.filter((f) => !f.archived).map((f) => [f.id, f]));
    return (values.get(conv.id) ?? [])
      .map((v) => ({ field: byId.get(v.fieldId), value: v.value.trim() }))
      .filter((v): v is { field: NonNullable<typeof v.field>; value: string } => Boolean(v.field && v.value))
      .sort((a, b) => a.field.position - b.field.position)
      .map((v) => ({ label: v.field.label, value: v.value }));
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

/** "Order ID DG-88412 · Refund for damaged parcel". Null when there is
 *  nothing to say, so the list falls back to the channel's own label. */
export function composeSubject(fields: { label: string; value: string }[], topic: string | null): string | null {
  const parts = [...fields.slice(0, SUBJECT_MAX_FIELDS).map((f) => `${f.label} ${f.value}`), topic?.trim()];
  const subject = parts.filter(Boolean).join(" · ");
  return subject ? subject.slice(0, 200) : null;
}
