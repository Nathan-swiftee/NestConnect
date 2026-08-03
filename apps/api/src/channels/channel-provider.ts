import type { ChannelType, Conversation } from "@ding/schemas";

export const CHANNEL_PROVIDERS = "CHANNEL_PROVIDERS";

export interface SendResult {
  ok: boolean;
  channelMsgId?: string;
  error?: string;
}

/** Optional context a provider can use (email threading, subjects). */
export interface SendContext {
  subject?: string;
  inReplyTo?: string;
  toName?: string;
}

export interface SendParams {
  to: string;
  body: string;
  conversation: Conversation;
  context?: SendContext;
}

/**
 * A channel adapter. The domain core never special-cases a provider — it sends
 * through this interface. Add SMS/Instagram/etc. later by implementing it.
 */
export abstract class ChannelProvider {
  abstract supports(channel: ChannelType): boolean;
  /** True in mock mode: the provider fakes delivered/read so ticks progress. */
  abstract get simulatesStatus(): boolean;
  abstract sendText(params: SendParams): Promise<SendResult>;
}
