import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import jwt from "jsonwebtoken";
import {
  ClientEvent,
  ServerEvent,
  type ClientToServerEvents,
  type Conversation,
  type Message,
  type Notification,
  type ServerToClientEvents,
} from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";
import { TenantContext } from "../tenancy/tenant-context";

type DingServer = Server<ClientToServerEvents, ServerToClientEvents>;
type DingSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const orgRoom = (orgId: string) => `org:${orgId}`;
const convRoom = (id: string) => `conversation:${id}`;

/** Pull one cookie value out of a raw `Cookie:` header. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

@WebSocketGateway({
  cors: { origin: env.corsOrigin, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly store: Store,
    private readonly tenant: TenantContext,
  ) {}

  @WebSocketServer()
  server!: DingServer;

  afterInit(server: DingServer) {
    if (!env.usingRedis) return;
    try {
      const pub = new Redis(env.redisUrl);
      const sub = pub.duplicate();
      server.adapter(createAdapter(pub, sub));
      this.logger.log("Socket.IO Redis adapter enabled");
    } catch (err) {
      this.logger.warn(`Redis adapter unavailable, running single-node: ${String(err)}`);
    }
  }

  async handleConnection(client: DingSocket): Promise<void> {
    // Authenticate the handshake with the same session token the REST API uses:
    // an unauthenticated socket would otherwise stream every conversation to
    // anyone who can reach the endpoint. Identity (and the org room) come from
    // the verified token, never from the client.
    //
    // Browsers carry it in the httpOnly cookie. Native clients pass it in the
    // socket.io handshake `auth` payload, because a phone's socket doesn't share
    // a cookie jar with its HTTP client.
    const handshakeAuth = client.handshake.auth as { token?: unknown } | undefined;
    const bearer = typeof handshakeAuth?.token === "string" ? handshakeAuth.token : undefined;
    const token = readCookie(client.handshake.headers.cookie, env.auth.cookieName) ?? bearer;
    let claims: { sub?: string; jti?: string; twofa?: string } | undefined;
    if (token) {
      try {
        claims = jwt.verify(token, env.auth.jwtSecret) as typeof claims;
      } catch {
        claims = undefined;
      }
    }
    // A half-authenticated "2FA pending" token is never a session.
    const userId = claims?.twofa ? undefined : claims?.sub;
    // Honour remote sign-out here too. It matters more on a socket than on a
    // request: a socket is opened once and then lives for hours, so without this
    // a revoked device would keep receiving the org's traffic until it reconnects.
    const revoked = claims?.jti ? await this.store.getSession(claims.jti).then((s) => !s || !!s.revokedAt) : false;
    const user = userId && !revoked ? await this.store.getUser(userId) : undefined;
    if (!user) {
      this.logger.debug(`socket rejected (no valid session): ${client.id}`);
      client.disconnect();
      return;
    }
    client.data.userId = user.id;
    client.data.orgId = user.orgId;
    client.join(orgRoom(user.orgId));
    client.join(`user:${user.id}`);
    this.logger.debug(`socket connected: ${client.id} (user ${user.id})`);
  }

  handleDisconnect(client: DingSocket) {
    this.logger.debug(`socket disconnected: ${client.id}`);
  }

  /**
   * Is this person looking at this conversation right now?
   *
   * Push asks before it sends: a banner for the thread that's already open and
   * updating in front of you is the single most obvious sign an app wasn't
   * thought through. Joining the conversation room is exactly "has it open", and
   * it's true for the web app as well — if they're reading it on a desktop, the
   * phone doesn't need to buzz either.
   *
   * Best-effort: a failure here must never stop a notification being sent, so it
   * answers "no" and the push goes out.
   */
  async isViewing(userId: string, conversationId: string): Promise<boolean> {
    try {
      const sockets = await this.server.in(convRoom(conversationId)).fetchSockets();
      return sockets.some((s) => (s.data as { userId?: string }).userId === userId);
    } catch (err) {
      this.logger.debug(`isViewing check failed: ${String(err)}`);
      return false;
    }
  }

  @SubscribeMessage(ClientEvent.JoinConversation)
  onJoin(@ConnectedSocket() client: DingSocket, @MessageBody() body: { conversationId: string }) {
    client.join(convRoom(body.conversationId));
  }

  @SubscribeMessage(ClientEvent.LeaveConversation)
  onLeave(@ConnectedSocket() client: DingSocket, @MessageBody() body: { conversationId: string }) {
    client.leave(convRoom(body.conversationId));
  }

  @SubscribeMessage(ClientEvent.Typing)
  onTyping(
    @ConnectedSocket() client: DingSocket,
    @MessageBody() body: { conversationId: string; typing: boolean; who?: string },
  ) {
    // Relay to the other agents on this thread (client.to excludes the sender).
    client.to(convRoom(body.conversationId)).emit(ServerEvent.Typing, {
      conversationId: body.conversationId,
      who: body.who?.trim() || "Someone",
      typing: body.typing,
    });
  }

  /* ---- server-side emit helpers, called by services ----
   * Events go to the owning org's room, so nothing ever crosses a tenant
   * boundary. Conversation-carrying emits derive the org from the conversation;
   * message emits take the org from the caller (falling back to the single-tenant
   * default when a caller doesn't yet thread it — the TenantContext seam). */

  emitMessageCreated(conversationId: string, message: Message, orgId: string = this.tenant.defaultOrgId) {
    this.server.to(orgRoom(orgId)).emit(ServerEvent.MessageCreated, { conversationId, message });
  }

  emitMessageUpdated(conversationId: string, message: Message, orgId: string = this.tenant.defaultOrgId) {
    this.server.to(orgRoom(orgId)).emit(ServerEvent.MessageUpdated, { conversationId, message });
  }

  emitConversationAssigned(conversation: Conversation, by?: string, reason?: string) {
    this.server.to(orgRoom(conversation.orgId)).emit(ServerEvent.ConversationAssigned, { conversation, by, reason });
  }

  emitConversationUpdated(conversation: Conversation) {
    this.server.to(orgRoom(conversation.orgId)).emit(ServerEvent.ConversationUpdated, { conversation });
  }

  /** A bell notification for one user — delivered only to their own room. */
  emitNotification(userId: string, notification: Notification) {
    this.server.to(`user:${userId}`).emit(ServerEvent.Notification, { notification });
  }
}
