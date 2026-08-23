/**
 * The seam between "what we want to notify someone about" and "how the bytes
 * reach their phone" — the same shape as ChannelProvider in src/channels, for
 * the same reason: the transport is a third party we should be able to replace
 * without touching the code that decides who gets told what.
 *
 * Today there is one implementation (Expo). Swapping to direct FCM + APNs later
 * is a second implementation, not a rewrite.
 */

/** One notification, addressed to one device. */
export interface PushMessage {
  /** The provider-specific device address (an Expo push token today). */
  to: string;
  title: string;
  body: string;
  /** Deep-link payload the app reads on tap — `{ conversationId, type }`. */
  data?: Record<string, string>;
  /** iOS app-icon badge: unread conversations, computed server-side. */
  badge?: number;
  /** Android channel id — `messages`, `mentions`, `assignments`, `reminders`.
   *  Channels are what let someone silence one class without silencing all. */
  channelId?: string;
  /** Replaces an earlier notification with the same key instead of stacking a
   *  second banner. One key per conversation, so five messages in one chat are
   *  one entry in the tray. */
  collapseKey?: string;
  /** `high` for a message someone is waiting on; `normal` lets the OS batch it. */
  priority?: "normal" | "high";
  /** Seconds the provider may keep retrying. A chat notification is worthless
   *  an hour late, so this is deliberately short. */
  ttlSeconds?: number;
  /** iOS `thread-id`: groups the tray by conversation, so one chat is one
   *  expandable stack rather than scattered banners. The Android equivalent is
   *  the collapse key, which is why both carry the conversation id. */
  threadId?: string;
  /** iOS notification category — which set of quick actions the banner offers
   *  when pulled down. Registered by the app at startup. */
  categoryId?: string;
  /** iOS interruption level. `time-sensitive` is allowed to break through
   *  Focus, which is right for an SLA about to breach and wrong for everything
   *  else — misusing it is how an app gets muted permanently. */
  interruptionLevel?: "passive" | "active" | "time-sensitive" | "critical";
}

/** What happened to one message at the point of *acceptance*, not delivery.
 *  `ticketId` is how the delivery receipt is looked up later. */
export interface PushSendResult {
  to: string;
  ok: boolean;
  ticketId?: string;
  /** Provider error code, e.g. `DeviceNotRegistered`. */
  error?: string;
  message?: string;
}

/** The outcome of a delivery, learned by polling receipts some minutes later.
 *  This is the only place `DeviceNotRegistered` surfaces — without it we would
 *  push at an uninstalled app forever. */
export interface PushReceipt {
  ticketId: string;
  status: "ok" | "error";
  error?: string;
  message?: string;
}

export abstract class PushProvider {
  /** Provider name, for logs. */
  abstract readonly name: string;

  /** Send a batch. Accepting a message is not delivering it — check receipts. */
  abstract send(messages: PushMessage[]): Promise<PushSendResult[]>;

  /** Look up what became of previously-accepted messages. */
  abstract receipts(ticketIds: string[]): Promise<PushReceipt[]>;
}
