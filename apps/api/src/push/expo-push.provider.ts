import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { Store } from "../data/store";
import { resolvePushConfig } from "./push-config";
import { PushProvider, type PushMessage, type PushReceipt, type PushSendResult } from "./push.provider";

const SEND_PATH = "/--/api/v2/push/send";
const RECEIPTS_PATH = "/--/api/v2/push/getReceipts";
/** Expo's documented ceiling per request. */
const BATCH = 100;
const TIMEOUT_MS = 15_000;

/** Expo's ticket for one accepted message. */
interface ExpoTicket {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Push delivery via the Expo push service.
 *
 * Expo holds the APNs key and FCM credentials and relays to both, which is why
 * one token per device is enough. The cost is a third party in the delivery
 * path — hence {@link PushProvider}, so replacing it with direct FCM + APNs is a
 * new class rather than a rewrite.
 *
 * Two things about this API are easy to get wrong and both are handled here:
 * a 200 response means *accepted*, not delivered — the ticket has its own
 * per-message status — and the real delivery outcome (in particular
 * `DeviceNotRegistered`, the only signal that an app was uninstalled) arrives
 * later through the receipts endpoint.
 */
@Injectable()
export class ExpoPushProvider extends PushProvider {
  readonly name = "expo";
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(private readonly store: Store) {
    super();
  }

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    if (!messages.length) return [];
    const out: PushSendResult[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      out.push(...(await this.sendBatch(messages.slice(i, i + BATCH))));
    }
    return out;
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushSendResult[]> {
    const body = batch.map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      ...(m.data ? { data: m.data } : {}),
      ...(m.badge === undefined ? {} : { badge: m.badge }),
      ...(m.channelId ? { channelId: m.channelId } : {}),
      // Expo maps this onto Android's collapse key and iOS's apns-collapse-id.
      ...(m.collapseKey ? { collapseId: m.collapseKey } : {}),
      ...(m.threadId ? { threadId: m.threadId } : {}),
      ...(m.categoryId ? { categoryId: m.categoryId } : {}),
      ...(m.interruptionLevel ? { interruptionLevel: m.interruptionLevel } : {}),
      priority: m.priority ?? "high",
      ...(m.ttlSeconds === undefined ? {} : { ttl: m.ttlSeconds }),
      sound: "default" as const,
    }));

    let json: { data?: ExpoTicket[]; errors?: { message?: string }[] } | null = null;
    try {
      // The send endpoint takes the array of messages as the whole body.
      json = await this.post<{ data?: ExpoTicket[]; errors?: { message?: string }[] }>(SEND_PATH, body);
    } catch (err) {
      // A push that can't be sent must never take a message send down with it.
      this.logger.warn(`Push send failed: ${String(err)}`);
      return batch.map((m) => ({ to: m.to, ok: false, error: "transport", message: String(err) }));
    }

    if (json?.errors?.length) {
      const message = json.errors[0]?.message ?? "Expo rejected the request";
      this.logger.warn(`Push send rejected: ${message}`);
      return batch.map((m) => ({ to: m.to, ok: false, error: "request", message }));
    }

    const tickets = json?.data ?? [];
    return batch.map((m, i) => {
      const t = tickets[i];
      if (!t) return { to: m.to, ok: false, error: "no_ticket", message: "Expo returned no ticket" };
      if (t.status === "error") {
        return { to: m.to, ok: false, error: t.details?.error ?? "error", message: t.message };
      }
      return { to: m.to, ok: true, ticketId: t.id };
    });
  }

  async receipts(ticketIds: string[]): Promise<PushReceipt[]> {
    if (!ticketIds.length) return [];
    const out: PushReceipt[] = [];
    for (let i = 0; i < ticketIds.length; i += BATCH) {
      const ids = ticketIds.slice(i, i + BATCH);
      let json: { data?: Record<string, ExpoTicket> } | null = null;
      try {
        json = await this.post<{ data?: Record<string, ExpoTicket> }>(RECEIPTS_PATH, { ids });
      } catch (err) {
        // Receipts are retried on the next sweep; a failed poll loses nothing.
        this.logger.warn(`Push receipt poll failed: ${String(err)}`);
        continue;
      }
      for (const [ticketId, r] of Object.entries(json?.data ?? {})) {
        out.push(
          r.status === "error"
            ? { ticketId, status: "error", error: r.details?.error ?? "error", message: r.message }
            : { ticketId, status: "ok" },
        );
      }
    }
    return out;
  }

  private async post<T>(path: string, payload: unknown): Promise<T | null> {
    const { accessToken } = await resolvePushConfig(this.store);
    const url = `${env.push.expoBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json().catch(() => null)) as T | null;
    } finally {
      clearTimeout(timer);
    }
  }
}
