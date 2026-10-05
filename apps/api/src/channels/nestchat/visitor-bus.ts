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
  | { kind: "reopened" }
  /**
   * An emoji landed on a message — from either side.
   *
   * Carries the whole message rather than the one emoji. Reactions are a set
   * with one slot per person, so a client applying a delta has to know what
   * was already there to know whether this one replaces it, and the two sides
   * disagree about that exactly when it matters: two taps in quick
   * succession. The payload is the same shape a message arrives in, so the
   * widget replaces the row it already has and is done.
   */
  | { kind: "reaction"; payload: unknown };

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
 * How long "the chat is on screen" is believed without being said again.
 *
 * An app repeats it every 25 seconds while it is true, so this only ever
 * matters for an app that went away without saying so — killed, crashed, out of
 * signal. Then it is how long a reply goes unpushed, which is why it is short.
 */
const VIEWING_TTL_S = 60;
const viewingKey = (conversationId: string) => `nestchat:viewing:${conversationId}`;

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

  /** Streams that count as somebody watching, per conversation, here. */
  private readonly watchers = new Map<string, number>();

  /** Conversations an app has said are on screen, and until when. */
  private readonly viewers = new Map<string, number>();

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
  /**
   * Listen to one conversation.
   *
   * [reportsViewing] is the difference between the two kinds of client. The web
   * widget's stream *is* its presence: the page is open, so somebody is looking.
   * An app's is not. It holds the stream for as long as somebody is signed in —
   * chat open or shut, app in front or in a pocket — so a connected app is not
   * a reading customer, and treating it as one is how replies went unpushed to
   * phones that were locked on a table. An app says when the chat is actually
   * on screen, through [setViewing], and its stream counts for nothing here.
   */
  subscribe(
    conversationId: string,
    handler: (event: VisitorEvent) => void,
    opts: { reportsViewing?: boolean } = {},
  ): () => void {
    this.local.on(conversationId, handler);
    if (opts.reportsViewing) {
      return () => this.local.off(conversationId, handler);
    }
    this.watchers.set(conversationId, (this.watchers.get(conversationId) ?? 0) + 1);
    void this.mark(conversationId);
    // Refreshed while the stream is up, so presence expires on its own if this
    // process dies rather than leaving a customer permanently "here".
    const beat = setInterval(() => void this.mark(conversationId), PRESENCE_TTL_S * 1000 * 0.4);
    return () => {
      clearInterval(beat);
      this.local.off(conversationId, handler);
      const left = (this.watchers.get(conversationId) ?? 1) - 1;
      if (left > 0) {
        this.watchers.set(conversationId, left);
        return;
      }
      this.watchers.delete(conversationId);
      void this.clear(conversationId);
    };
  }

  /**
   * An app saying its chat is on screen — or that it no longer is.
   *
   * Believed for [VIEWING_TTL_S] at a time and repeated by the app while true,
   * so an app that disappears without a word stops counting within a minute
   * instead of silencing that customer's notifications for good.
   */
  async setViewing(conversationId: string, viewing: boolean): Promise<void> {
    if (viewing) this.viewers.set(conversationId, Date.now() + VIEWING_TTL_S * 1000);
    else this.viewers.delete(conversationId);
    if (!this.publisher) return;
    try {
      if (viewing) await this.publisher.set(viewingKey(conversationId), "1", "EX", VIEWING_TTL_S);
      else await this.publisher.del(viewingKey(conversationId));
    } catch {
      // Presence is an optimisation. Losing it costs a duplicate banner.
    }
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
    if ((this.watchers.get(conversationId) ?? 0) > 0) return true;
    const until = this.viewers.get(conversationId);
    if (until !== undefined) {
      if (until > Date.now()) return true;
      this.viewers.delete(conversationId);
    }
    if (!this.publisher) return false;
    try {
      return (
        (await this.publisher.exists(presenceKey(conversationId), viewingKey(conversationId))) > 0
      );
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
