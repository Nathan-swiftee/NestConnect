import type { ChannelType, Conversation } from "@ding/schemas";

export const CHANNEL_PROVIDERS = "CHANNEL_PROVIDERS";

export interface SendResult {
  ok: boolean;
  channelMsgId?: string;
  error?: string;
}

/**
 * A channel adapter. The domain core never special-cases a provider — it sends
 * through this interface. Add SMS/Instagram/email later by implementing it.
 */
export abstract class ChannelProvider {
  abstract supports(channel: ChannelType): boolean;
  /** True in mock mode: the provider fakes delivered/read so ticks progress. */
  abstract get simulatesStatus(): boolean;
  abstract sendText(params: { to: string; body: string; conversation: Conversation }): Promise<SendResult>;
}
