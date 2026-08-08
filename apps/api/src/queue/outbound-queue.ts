import type { DeliveryJob } from "../channels/outbound-delivery.service";

/**
 * A durable outbound-delivery queue. Two implementations back it: {@link
 * BullOutboundQueue} (when REDIS_URL is set — jobs persist in Redis, survive
 * restarts, and retry with exponential backoff) and {@link InlineOutboundQueue}
 * (no Redis; dev/CI — best-effort in-process). Services depend on this abstract
 * token, never a concrete queue — the choice is made once in {@link QueueModule}.
 */
export abstract class OutboundQueue {
  /**
   * Enqueue a message for delivery. `idempotencyKey` becomes the job identity, so
   * duplicate enqueues of the same logical send collapse to a single job.
   */
  abstract enqueueDelivery(job: DeliveryJob, idempotencyKey?: string): Promise<void>;

  /**
   * Re-drive messages left in flight (queued/sending) by a crash or restart —
   * closing the window between the DB save and the enqueue. Returns how many were
   * re-driven. `olderThanMs` skips very recent messages a live worker may hold.
   */
  abstract recoverStuck(olderThanMs?: number): Promise<number>;
}
