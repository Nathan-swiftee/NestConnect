import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { env } from "../../config/env";

/** Everything a visitor's browser can be told about their own conversation. */
export type VisitorEvent =
  | { kind: "message"; payload: unknown }
  | { kind: "typing"; who: string; typing: boolean }
  /** An agent has read what the visitor wrote — the widget's "Seen". */
  | { kind: "read"; at: string }
  /** An agent closed the chat: the widget says so and stops taking messages. */
  | { kind: "closed" }
  /** …and reopened it, so the widget lets them write again without a reload. */
  | { kind: "reopened" };

const CHANNEL = "nestchat:visitor";

/**
 * How long a customer counts as present after their stream last said so.
 *
 * Longer than the SSE heartbeat, so an ordinary beat never lets it lapse;
 * short enough that a phone going into a pocket is pushable within seconds
 * rather than minutes.
 */
const PRESENCE_TTL_S = 45;
const presenceKey = (conversationId: string) => `nestchat:watching:${conversationId}`;

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
    void this.mark(conversationId);
    // Refreshed while the stream is up, so presence expires on its own if this
    // process dies rather than leaving a customer permanently "here".
    const beat = setInterval(() => void this.mark(conversationId), PRESENCE_TTL_S * 1000 * 0.4);
    return () => {
      clearInterval(beat);
      this.local.off(conversationId, handler);
      if (!this.local.listenerCount(conversationId)) void this.clear(conversationId);
    };
  }

  /**
   * Is this customer's chat actually open in front of them?
   *
   * What it decides is whether an agent's reply also rings their phone. A
   * message arriving live on screen and again as a banner is the thing that
   * makes people turn notifications off.
   *
   * "Open" is read as "holding a live stream", which is a good proxy and not a
   * perfect one: an app in the background loses the socket within seconds, so
   * it gets the push; an app in the foreground keeps it, so it does not. What
   * it cannot tell is a phone lying face-up on a table with the chat open, and
   * the failure there is a notification nobody needed rather than a message
   * nobody got.
   *
   * Across replicas it has to be shared — the customer's stream is very likely
   * held by a different process than the one handling the agent's reply — so
   * Redis holds a short-lived key. Without Redis there is one process, and its
   * own listener count is the whole truth.
   */
  async isWatching(conversationId: string): Promise<boolean> {
    if (this.local.listenerCount(conversationId) > 0) return true;
    if (!this.publisher) return false;
    try {
      return (await this.publisher.exists(presenceKey(conversationId))) === 1;
    } catch {
      // Unreachable Redis means we cannot prove they are watching. Pushing
      // anyway is the safer failure: a spare notification beats a customer
      // never hearing back.
      return false;
    }
  }

  private async mark(conversationId: string): Promise<void> {
    if (!this.publisher) return;
    try {
      await this.publisher.set(presenceKey(conversationId), "1", "EX", PRESENCE_TTL_S);
    } catch {
      // Presence is an optimisation. Losing it costs a duplicate banner.
    }
  }

  private async clear(conversationId: string): Promise<void> {
    if (!this.publisher) return;
    try {
      await this.publisher.del(presenceKey(conversationId));
    } catch {
      // It expires on its own.
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }
}
