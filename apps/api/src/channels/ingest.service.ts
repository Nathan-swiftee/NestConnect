import { Injectable, Logger } from "@nestjs/common";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RoutingService } from "./routing.service";

export interface WhatsAppInbound {
  phoneNumberId: string;
  from: string; // E.164
  name?: string;
  text: string;
  channelMsgId?: string;
}

/**
 * Channel-agnostic inbound pipeline: resolve the inbox, unify the contact,
 * find or open a conversation (routing new ones), append the message, and emit
 * realtime events. A new channel just needs to call this with a normalized
 * payload — the routing, persistence, and realtime are shared.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly store: Store,
    private readonly routing: RoutingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async ingestWhatsApp(input: WhatsAppInbound): Promise<{ conversationId: string; created: boolean } | undefined> {
    const inbox = await this.store.getInboxByWhatsAppPhoneId(input.phoneNumberId);
    if (!inbox) {
      this.logger.warn(`No inbox mapped for WhatsApp phone id ${input.phoneNumberId}`);
      return undefined;
    }

    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      kind: "phone",
      value: input.from,
      displayName: input.name || input.from,
    });

    const { conversation, created } = await this.store.findOrCreateOpenConversation({
      orgId: inbox.orgId,
      inboxId: inbox.id,
      contact,
      channel: inbox.type,
    });

    let conv = conversation;
    if (created) {
      const decision = await this.routing.route(inbox, contact);
      const assigned = await this.store.assign(conv.id, decision);
      if (assigned) conv = assigned;
      this.realtime.emitConversationAssigned(conv, "auto-routing");
      this.logger.log(
        `New WhatsApp conversation ${conv.id} from ${input.from} → ` +
          `${decision.assigneeUserId ? `agent ${decision.assigneeUserId}` : `team ${decision.assignedTeamId} (up for grabs)`}`,
      );
    }

    const message = await this.store.appendInboundMessage(conv.id, {
      authorName: contact.displayName,
      body: input.text,
      channelMsgId: input.channelMsgId,
    });
    if (message) this.realtime.emitMessageCreated(conv.id, message);

    return { conversationId: conv.id, created };
  }
}
