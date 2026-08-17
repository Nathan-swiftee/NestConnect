import type { AttachmentKind, ChannelType, Conversation } from "@ding/schemas";

export const CHANNEL_PROVIDERS = "CHANNEL_PROVIDERS";

export interface SendResult {
  ok: boolean;
  channelMsgId?: string;
  error?: string;
  /** Provider-specific error code (WhatsApp error.code, Postmark ErrorCode …). */
  errorCode?: string;
  /** Transport status of the failed call, used to classify transient vs permanent. */
  httpStatus?: number;
  /**
   * Explicit retry hint. When set it wins over the httpStatus heuristic — e.g. a
   * network error (no response) sets `retryable: true`; a rejected recipient sets
   * `retryable: false`.
   */
  retryable?: boolean;
  /**
   * True when the send was mocked (no live credentials), so the dispatcher can
   * fake delivered/read ticks. Real sends leave this false and let the channel's
   * own status webhooks move the ticks.
   */
  simulated?: boolean;
}

/**
 * Whether a failed transport call is worth retrying: network/unknown failures
 * (no status) and 408/429/5xx are transient; explicit 4xx are permanent.
 */
export function isRetryableStatus(status?: number): boolean {
  if (status == null) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500 && status <= 599;
}

/** Optional context a provider can use (email threading, subjects). */
export interface SendContext {
  subject?: string;
  /** Message-ID of the email this reply answers (the In-Reply-To header). */
  inReplyTo?: string;
  /** Full RFC 5322 References chain to emit — every known Message-ID in the
   *  thread, space-separated and in order, ending with the parent. Falls back to
   *  `inReplyTo` when absent. This is what mail clients actually thread on. */
  references?: string;
  /** Gmail server-side thread id, to keep an email reply in the same thread
   *  (Gmail provider only; other providers ignore it). */
  threadId?: string;
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
  /** Sanitized HTML body for a rich email reply (email providers only). */
  bodyHtml?: string;
  /** Extra email recipients (email providers only). */
  cc?: string[];
  bcc?: string[];
  /** The sender's HTML signature to append to the outbound email body (email
   *  providers only). Appended to the wire body; never on the stored message. */
  signatureHtml?: string;
  conversation: Conversation;
  /** The inbox to send FROM — the conversation's own inbox for a same-channel
   *  reply, or another channel's inbox for a cross-channel reply (its creds/
   *  from-address are used). Falls back to the conversation's inbox. */
  inboxId?: string;
  context?: SendContext;
  /** Media to deliver alongside (or instead of) the text body. */
  media?: OutboundMedia[];
  /** When set, deliver this as a WhatsApp template message (type:template). */
  template?: OutboundTemplate;
  /** Provider id of a message this one quotes/replies to (WhatsApp context). */
  replyToChannelMsgId?: string;
  /** An open-tracking pixel URL to embed (email providers only). When set, a
   *  hidden 1×1 `<img>` pointing here is appended to the HTML body so a request
   *  for it records that THIS recipient opened the email (per-recipient copies). */
  trackingPixelUrl?: string;
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

  /**
   * React to a message with an emoji (empty removes it). Optional — only
   * channels that support reactions (WhatsApp) implement it.
   */
  sendReaction?(params: {
    conversation: Conversation;
    channelMsgId: string;
    emoji: string;
  }): Promise<void>;
}
