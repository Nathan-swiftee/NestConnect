import type { AttachmentKind, ChannelType, Conversation } from "@ding/schemas";

export const CHANNEL_PROVIDERS = "CHANNEL_PROVIDERS";

export interface SendResult {
  ok: boolean;
  channelMsgId?: string;
  error?: string;
  /**
   * True when the send was mocked (no live credentials), so the dispatcher can
   * fake delivered/read ticks. Real sends leave this false and let the channel's
   * own status webhooks move the ticks.
   */
  simulated?: boolean;
}

/** Optional context a provider can use (email threading, subjects). */
export interface SendContext {
  subject?: string;
  inReplyTo?: string;
  toName?: string;
}

/** A resolved outbound media file (bytes in hand), handed to a provider to send. */
export interface OutboundMedia {
  kind: AttachmentKind;
  mime: string;
  filename: string;
  bytes: Buffer;
  durationMs?: number;
}

/** An approved WhatsApp template to send (used to re-open a closed 24h window). */
export interface OutboundTemplate {
  name: string;
  language: string;
  /** Values filling the body's {{1}}, {{2}} … variables, in order. */
  params: string[];
}

export interface SendParams {
  to: string;
  body: string;
  conversation: Conversation;
  context?: SendContext;
  /** Media to deliver alongside (or instead of) the text body. */
  media?: OutboundMedia[];
  /** When set, deliver this as a WhatsApp template message (type:template). */
  template?: OutboundTemplate;
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
  abstract sendText(params: SendParams): Promise<SendResult>;

  /**
   * Send a read receipt for an inbound message (so the customer sees blue ticks).
   * Optional — only channels that support it (WhatsApp) implement it.
   */
  markRead?(params: { conversation: Conversation; channelMsgId: string }): Promise<void>;

  /**
   * Show the customer a "typing…" indicator (WhatsApp shows it for up to ~25s,
   * or until the next message). Tied to the customer's latest inbound message.
   * Optional — only channels that support it implement it.
   */
  sendTyping?(params: { conversation: Conversation; channelMsgId: string }): Promise<void>;
}
