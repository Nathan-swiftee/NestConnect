import { Injectable, Logger } from "@nestjs/common";
import { GROUP_MAX_MEMBERS, type Conversation, type MessageType } from "@ding/schemas";
import { Store, type AttachmentInput } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RoutingService } from "./routing.service";
import { sanitizeEmailHtml } from "./email/html-sanitize";

export interface WhatsAppInbound {
  phoneNumberId: string;
  from: string; // E.164
  name?: string;
  text: string;
  channelMsgId?: string;
  messageType?: MessageType;
  attachments?: AttachmentInput[];
  /** Id of the message this one replies to (already resolved to our id). */
  quotedMsgId?: string;
}

export interface EmailInbound {
  toAddress: string;
  from: string;
  fromName?: string;
  subject?: string;
  text: string;
  /** Raw HTML body, if the email had one — sanitized here before storage. */
  html?: string;
  messageId?: string;
  references?: string[]; // In-Reply-To + References header ids, for threading
  messageType?: MessageType;
  attachments?: AttachmentInput[];
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
      await this.applyTeamSla(conv);
      this.realtime.emitConversationAssigned(conv, "auto-routing");
      this.logger.log(
        `New WhatsApp conversation ${conv.id} from ${input.from} → ` +
          `${decision.assigneeUserId ? `agent ${decision.assigneeUserId}` : `team ${decision.assignedTeamId} (queue)`}`,
      );
    }

    const message = await this.store.appendInboundMessage(conv.id, {
      authorName: contact.displayName,
      body: input.text,
      channelMsgId: input.channelMsgId,
      messageType: input.messageType,
      attachments: input.attachments,
      quotedMsgId: input.quotedMsgId,
    });
    if (message) this.realtime.emitMessageCreated(conv.id, message);

    return { conversationId: conv.id, created };
  }

  /** Inbound message in an existing WhatsApp group — routed by group id, attributed to the sender. */
  async ingestWhatsAppGroup(input: {
    groupId: string;
    from: string;
    name?: string;
    text: string;
    channelMsgId?: string;
    messageType?: MessageType;
    attachments?: AttachmentInput[];
    quotedMsgId?: string;
  }): Promise<{ conversationId: string; created: boolean } | undefined> {
    const conversationId = await this.store.findConversationByChannelRef(input.groupId);
    if (!conversationId) {
      this.logger.warn(`No group conversation for WhatsApp group ${input.groupId}`);
      return undefined;
    }
    const conv = await this.store.getConversation(conversationId);
    const contact = await this.store.upsertContactByIdentity({
      orgId: conv?.orgId ?? "org_swiftee",
      kind: "phone",
      value: input.from,
      displayName: input.name || input.from,
    });
    const isMember = conv?.participants.some((p) => p.contact.id === contact.id) ?? false;
    if (!isMember && (await this.store.countParticipants(conversationId)) < GROUP_MAX_MEMBERS) {
      await this.store.addParticipant(conversationId, contact);
    }

    const message = await this.store.appendInboundMessage(conversationId, {
      authorName: contact.displayName,
      body: input.text,
      channelMsgId: input.channelMsgId,
      messageType: input.messageType,
      attachments: input.attachments,
      quotedMsgId: input.quotedMsgId,
    });
    if (message) this.realtime.emitMessageCreated(conversationId, message);
    return { conversationId, created: false };
  }

  async ingestEmail(input: EmailInbound): Promise<{ conversationId: string; created: boolean } | undefined> {
    const inbox = await this.store.getInboxByEmailAddress(input.toAddress);
    if (!inbox) {
      this.logger.warn(`No inbox mapped for email address ${input.toAddress}`);
      return undefined;
    }

    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      kind: "email",
      value: input.from.toLowerCase(),
      displayName: input.fromName || input.from,
    });

    // Thread onto an existing conversation via References/In-Reply-To first.
    let conversationId = input.references?.length
      ? await this.store.findConversationByMessageChannelIds(input.references)
      : undefined;
    let created = false;

    if (!conversationId) {
      const res = await this.store.findOrCreateOpenConversation({
        orgId: inbox.orgId,
        inboxId: inbox.id,
        contact,
        channel: "email",
        subject: input.subject,
      });
      conversationId = res.conversation.id;
      created = res.created;
      if (created) {
        const decision = await this.routing.route(inbox, contact);
        const assigned = await this.store.assign(conversationId, decision);
        if (assigned) await this.applyTeamSla(assigned);
        this.realtime.emitConversationAssigned(assigned ?? res.conversation, "auto-routing");
        this.logger.log(
          `New email conversation ${conversationId} from ${input.from} → ` +
            `${decision.assigneeUserId ? `agent ${decision.assigneeUserId}` : `team ${decision.assignedTeamId} (queue)`}`,
        );
      }
    }

    // Sanitize the email's HTML once, at the boundary — the stored bodyHtml is
    // always safe for the sandboxed iframe to render (remote images pre-blocked).
    const { html: bodyHtml } = sanitizeEmailHtml(input.html);

    const message = await this.store.appendInboundMessage(conversationId, {
      authorName: contact.displayName,
      body: input.text,
      bodyHtml: bodyHtml || undefined,
      channelMsgId: input.messageId,
      messageType: input.messageType,
      attachments: input.attachments,
    });
    if (message) this.realtime.emitMessageCreated(conversationId, message);

    return { conversationId, created };
  }

  /** A new conversation inherits its routed team's first-response SLA target. */
  private async applyTeamSla(conv: Conversation): Promise<void> {
    if (!conv.assignedTeamId || conv.slaDueAt) return;
    const team = await this.store.getTeam(conv.assignedTeamId);
    if (!team?.slaMinutes) return;
    const due = new Date(Date.now() + team.slaMinutes * 60_000).toISOString();
    await this.store.setSla(conv.id, due);
  }
}
