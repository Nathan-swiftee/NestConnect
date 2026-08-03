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
import {
  ClientEvent,
  ServerEvent,
  type ClientToServerEvents,
  type Conversation,
  type Message,
  type ServerToClientEvents,
} from "@ding/schemas";
import { env } from "../config/env";
import { ORG_ID, DEMO_USER_ID } from "../data/fixtures";

type DingServer = Server<ClientToServerEvents, ServerToClientEvents>;
type DingSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const orgRoom = (orgId: string) => `org:${orgId}`;
const convRoom = (id: string) => `conversation:${id}`;

@WebSocketGateway({
  cors: { origin: env.corsOrigin, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

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

  handleConnection(client: DingSocket) {
    // Phase 0 is single-tenant/single-user: every socket joins the demo org and
    // the demo user's room. Auth + real identity land in a later phase.
    client.join(orgRoom(ORG_ID));
    client.join(`user:${DEMO_USER_ID}`);
    this.logger.debug(`socket connected: ${client.id}`);
  }

  handleDisconnect(client: DingSocket) {
    this.logger.debug(`socket disconnected: ${client.id}`);
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
  onTyping(@ConnectedSocket() client: DingSocket, @MessageBody() body: { conversationId: string; typing: boolean }) {
    client.to(convRoom(body.conversationId)).emit(ServerEvent.Typing, {
      conversationId: body.conversationId,
      who: "someone",
      typing: body.typing,
    });
  }

  /* ---- server-side emit helpers, called by services ---- */

  emitMessageCreated(conversationId: string, message: Message) {
    this.server.to(orgRoom(ORG_ID)).emit(ServerEvent.MessageCreated, { conversationId, message });
  }

  emitMessageUpdated(conversationId: string, message: Message) {
    this.server.to(orgRoom(ORG_ID)).emit(ServerEvent.MessageUpdated, { conversationId, message });
  }

  emitConversationAssigned(conversation: Conversation, by?: string, reason?: string) {
    this.server.to(orgRoom(ORG_ID)).emit(ServerEvent.ConversationAssigned, { conversation, by, reason });
  }

  emitConversationUpdated(conversation: Conversation) {
    this.server.to(orgRoom(ORG_ID)).emit(ServerEvent.ConversationUpdated, { conversation });
  }
}
