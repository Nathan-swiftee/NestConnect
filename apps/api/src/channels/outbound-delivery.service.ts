import { Injectable, Logger } from "@nestjs/common";
import type { MessageStatus } from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ChannelDispatcher } from "./channel-dispatcher";
import type { OutboundTemplate } from "./channel-provider";

/** The pointer a delivery job carries — everything else is loaded from the DB. */
export interface DeliveryJob {
  messageId: string;
  conversationId: string;
}

/** What one delivery attempt did, so the queue can decide whether to retry. */
export type DeliverResult =
  | { state: "sent"; channelMsgId?: string; simulated: boolean }
  | { state: "skipped"; reason: string }
  | { state: "failed-permanent"; reason: string }
  | { state: "failed-transient"; error?: string };

/**
 * Orchestrates a single durable outbound delivery: it is the only place that
 * moves an outbound message through queued → sending → sent | failed and
 * broadcasts each change. It is driven by the queue layer (BullMQ in production,
 * an inline runner without Redis), so it holds no timers and no retry loop —
 * it reports the outcome and lets the queue own scheduling.
 *
 * Everything needed to (re)send is read from the DB by message id, so a job is
 * just a pointer: a crash between the DB save and the send loses nothing — the
 * message sits in `queued`/`sending` and is re-driven on restart.
 */
@Injectable()
export class OutboundDeliveryService {
  private readonly logger = new Logger(OutboundDeliveryService.name);

  constructor(
    private readonly store: Store,
    private readonly dispatcher: ChannelDispatcher,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Run one send attempt for a message. Idempotent: a message already past the
   *  sending stage (or failed/internal/missing) is skipped, so re-delivering the
   *  same job never double-sends. */
  async deliver(job: DeliveryJob): Promise<DeliverResult> {
    const ref = await this.store.getOutboundMessage(job.messageId);
    if (!ref) return { state: "skipped", reason: "message not found" };
    if (ref.internal) return { state: "skipped", reason: "internal note" };
    // Only a queued (or mid-attempt) message is sendable. Anything sent/delivered/
    // read is already done; failed waits for an explicit retry (which re-queues it).
    if (ref.status !== "queued" && ref.status !== "sending") {
      return { state: "skipped", reason: `status ${ref.status}` };
    }

    // Claim the attempt: queued → sending (+ attemptCount/lastAttemptAt), broadcast.
    const sending = await this.store.markMessageSending(job.messageId);
    if (!sending) return { state: "skipped", reason: "not in a sendable state" };
    this.realtime.emitMessageUpdated(sending.conversationId, sending.message);

    // Load the full thread so the provider has threading/media/quote context.
    const conversation = await this.store.getConversation(ref.conversationId);
    const message = conversation?.messages.find((m) => m.id === job.messageId);
    if (!conversation || !message) {
      const reason = "Conversation or message no longer exists";
      const change = await this.store.recordSendFailure(job.messageId, { permanent: true, reason });
      if (change) this.realtime.emitMessageUpdated(change.conversationId, change.message);
      return { state: "failed-permanent", reason };
    }

    const template: OutboundTemplate | undefined = ref.deliveryMeta?.template;
    const cc = ref.deliveryMeta?.cc;
    const bcc = ref.deliveryMeta?.bcc;

    const outcome = await this.dispatcher.attemptSend(conversation, message, template, { cc, bcc });

    if (outcome.ok) {
      const change = await this.store.markMessageSent(job.messageId, outcome.channelMsgId);
      if (change) this.realtime.emitMessageUpdated(change.conversationId, change.message);
      return { state: "sent", channelMsgId: outcome.channelMsgId, simulated: outcome.simulated };
    }

    if (outcome.retryable) {
      // Keep the message in flight (still "sending"); just record diagnostics so
      // the UI keeps showing "sending" while the queue backs off and retries.
      await this.store.recordSendFailure(job.messageId, {
        permanent: false,
        error: outcome.error,
        code: outcome.code,
      });
      return { state: "failed-transient", error: outcome.error };
    }

    // Permanent failure — mark failed with a human reason and broadcast.
    const change = await this.store.recordSendFailure(job.messageId, {
      permanent: true,
      error: outcome.error,
      code: outcome.code,
      reason: outcome.reason,
    });
    if (change) this.realtime.emitMessageUpdated(change.conversationId, change.message);
    return { state: "failed-permanent", reason: outcome.reason };
  }

  /** Apply a delivery-ladder status transition (used by the mock delivered/read
   *  progression and by any deferred status job). Ladder-guarded in the store. */
  async applyStatus(channelMsgId: string, status: MessageStatus): Promise<void> {
    const updated = await this.store.updateMessageStatusByChannelId(channelMsgId, status);
    if (updated) this.realtime.emitMessageUpdated(updated.conversationId, updated.message);
  }

  /** Give up on a message after the queue has exhausted its retries. */
  async markExhausted(messageId: string, reason: string): Promise<void> {
    const change = await this.store.recordSendFailure(messageId, { permanent: true, reason });
    if (change) {
      this.logger.warn(`Delivery permanently failed for ${messageId}: ${reason}`);
      this.realtime.emitMessageUpdated(change.conversationId, change.message);
    }
  }
}
