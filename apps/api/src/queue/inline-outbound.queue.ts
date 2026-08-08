import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Store } from "../data/store";
import { OutboundDeliveryService, type DeliveryJob } from "../channels/outbound-delivery.service";
import { OutboundQueue } from "./outbound-queue";

/** Best-effort in-process attempts before giving up (no Redis to persist retries). */
const INLINE_ATTEMPTS = 4;
const BACKOFF_MS = 2000;
const MOCK_DELIVERED_MS = 1400;
const MOCK_READ_MS = 3200;

/**
 * In-process fallback for the zero-infra path (no REDIS_URL) — dev, CI, and
 * single-node self-hosting. Runs deliveries out-of-band on the event loop with a
 * small bounded retry, and re-drives anything left in flight on boot. It is NOT
 * crash-durable the way BullMQ is (nothing survives a hard restart mid-flight
 * beyond what the DB recovery sweep re-drives), which is why production runs with
 * Redis; but it preserves the exact same delivery semantics for local use.
 */
@Injectable()
export class InlineOutboundQueue extends OutboundQueue implements OnApplicationBootstrap {
  private readonly logger = new Logger(InlineOutboundQueue.name);

  constructor(
    private readonly delivery: OutboundDeliveryService,
    private readonly store: Store,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    const recovered = await this.recoverStuck(0);
    this.logger.log(
      `Inline outbound queue ready${recovered ? ` (re-drove ${recovered} in-flight message(s))` : ""}`,
    );
  }

  async enqueueDelivery(job: DeliveryJob): Promise<void> {
    // Out-of-band on the event loop so the HTTP request returns immediately.
    setImmediate(() => void this.run(job, 0));
  }

  private async run(job: DeliveryJob, attempt: number): Promise<void> {
    try {
      const result = await this.delivery.deliver(job);
      if (result.state === "failed-transient") {
        if (attempt + 1 >= INLINE_ATTEMPTS) {
          await this.delivery.markExhausted(
            job.messageId,
            `Delivery failed after ${attempt + 1} attempts: ${result.error ?? "transient error"}`,
          );
          return;
        }
        const delay = BACKOFF_MS * 2 ** attempt;
        setTimeout(() => void this.run(job, attempt + 1), delay).unref?.();
        return;
      }
      if (result.state === "sent" && result.simulated && result.channelMsgId) {
        this.scheduleMockLadder(result.channelMsgId);
      }
    } catch (err) {
      this.logger.warn(`Inline delivery error for ${job.messageId}: ${String(err)}`);
    }
  }

  private scheduleMockLadder(channelMsgId: string): void {
    setTimeout(() => void this.delivery.applyStatus(channelMsgId, "delivered"), MOCK_DELIVERED_MS).unref?.();
    setTimeout(() => void this.delivery.applyStatus(channelMsgId, "read"), MOCK_READ_MS).unref?.();
  }

  async recoverStuck(olderThanMs = 0): Promise<number> {
    const stuck = await this.store.listStuckOutbound(olderThanMs);
    for (const s of stuck) {
      await this.enqueueDelivery({ messageId: s.messageId, conversationId: s.conversationId });
    }
    return stuck.length;
  }
}
