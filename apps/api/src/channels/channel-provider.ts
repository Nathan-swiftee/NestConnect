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
 * Extra hints for picking a provider when several serve the same channel — e.g.
 * "email" is served by Postmark by default but by Gmail for a Gmail-connected
 * inbox. `provider` is the inbox's channelConfig.provider ("gmail" etc.).
 */
export interface SupportsContext {
  provider?: string;
}

/**
 * A channel adapter. The domain core never special-cases a provider — it sends
 * through this interface. Add SMS/Instagram/etc. later by implementing it.
 */
export abstract class ChannelProvider {
  /**
   * Whether this provider handles the given channel. The optional context lets
   * providers that share a channel divide it by inbox (Gmail vs generic email).
   */
  abstract supports(channel: ChannelType, ctx?: SupportsContext): boolean;
  /** True in mock mode: the provider fakes delivered/read so ticks progress. */
  abstract get simulatesStatus(): boolean;
  abstract sendText(params: SendParams): Promise<SendResult>;
}
