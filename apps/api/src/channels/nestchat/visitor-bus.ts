import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { env } from "../../config/env";

/** Everything a visitor's browser can be told about their own conversation. */
export type VisitorEvent =
  | { kind: "message"; payload: unknown }
  | { kind: "typing"; who: string; typing: boolean }
  | { kind: "closed" };

const CHANNEL = "nestchat:visitor";

/**
 * Fan-out to visitors' open widgets.
 *
 * Agents get their realtime over the authenticated Socket.IO gateway. Visitors
 * deliberately do not: their widget runs inside an iframe on somebody else's
 * website, where the socket handshake would have to pass a CORS policy we can't
 * loosen without also loosening it for the agent socket that carries session
 * cookies. So visitors are served by plain Server-Sent Events — ordinary HTTP,
 * covered by the same per-route CORS as the rest of the public widget API, and
 * reconnecting on their own via the browser's EventSource.
 *
 * That leaves this: a way for the process handling an agent's reply to reach the
 * process holding that visitor's open stream. In-process when there is one
 * replica; through Redis when there are several — the same seam Socket.IO uses,
 * so both halves of realtime scale the same way.
 */
@Injectable()
export class VisitorBus implements OnModuleDestroy {
  private readonly logger = new Logger(VisitorBus.name);
  /** Local listeners, keyed by conversation id. Also the delivery path for a
   *  single-replica deployment, where Redis isn't in play at all. */
  private readonly local = new EventEmitter();
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor() {
    // Node's default of 10 listeners is a leak warning, not a limit, and a busy
    // widget legitimately has more than ten visitors streaming at once.
    this.local.setMaxListeners(0);
    if (!env.usingRedis) return;
    try {
      this.publisher = new Redis(env.redisUrl);
      this.subscriber = new Redis(env.redisUrl);
      void this.subscriber.subscribe(CHANNEL);
      this.subscriber.on("message", (_channel, raw) => {
        try {
          const { conversationId, event } = JSON.parse(raw) as {
            conversationId: string;
            event: VisitorEvent;
          };
          this.local.emit(conversationId, event);
        } catch (err) {
          this.logger.warn(`Unreadable visitor event: ${String(err)}`);
        }
      });
      this.logger.log("NestChat visitor bus using Redis");
    } catch (err) {
      // A missing Redis must not take the widget down — a single replica is
      // still correct without it, it just can't fan out to its siblings.
      this.logger.warn(`Redis unavailable, visitor bus running in-process: ${String(err)}`);
      this.publisher = undefined;
      this.subscriber = undefined;
    }
  }

  /** Tell whoever holds this visitor's stream. Never throws — a live chat
   *  losing a frame must not fail the agent's send, which is already stored. */
  publish(conversationId: string, event: VisitorEvent): void {
    if (this.publisher) {
      // Redis loops the message back to our own subscriber, so publishing
      // locally as well would deliver it twice.
      this.publisher
        .publish(CHANNEL, JSON.stringify({ conversationId, event }))
        .catch((err) => this.logger.warn(`Visitor event not published: ${String(err)}`));
      return;
    }
    this.local.emit(conversationId, event);
  }

  /** Listen for one conversation's events. Returns the unsubscribe. */
  subscribe(conversationId: string, handler: (event: VisitorEvent) => void): () => void {
    this.local.on(conversationId, handler);
    return () => this.local.off(conversationId, handler);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }
}
