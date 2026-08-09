import { Module, type Provider } from "@nestjs/common";
import { env } from "../config/env";
import { ChannelsModule } from "../channels/channels.module";
import { OutboundQueue } from "./outbound-queue";
import { BullOutboundQueue } from "./bull-outbound.queue";
import { InlineOutboundQueue } from "./inline-outbound.queue";

// Pick the queue implementation once, by configuration — mirroring how DataModule
// chooses its Store. With Redis we get durable, retrying BullMQ delivery; without
// it, an in-process fallback that keeps the same semantics for dev/CI.
const queueProvider: Provider = {
  provide: OutboundQueue,
  useClass: env.usingRedis ? BullOutboundQueue : InlineOutboundQueue,
};

@Module({
  // ChannelsModule supplies OutboundDeliveryService + GmailSyncService; Store is
  // global (DataModule). Both queue impls resolve their deps from here.
  imports: [ChannelsModule],
  providers: [queueProvider],
  exports: [OutboundQueue],
})
export class QueueModule {}
