import { Injectable, Logger } from "@nestjs/common";
import { GROUP_MAX_MEMBERS, type Conversation, type MessageType } from "@ding/schemas";
import { Store, type AttachmentInput } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TenantContext } from "../tenancy/tenant-context";
import { PushService } from "../push/push.service";
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
  /** WhatsApp flagged this as forwarded to us rather than written by the sender. */
  forwarded?: boolean;
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
  /** Gmail server-side thread id (Gmail ingest only). Persisted on the
   *  conversation so an outbound reply can be sent back into the same thread. */
  threadId?: string;
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
    private readonly tenant: TenantContext,
    private readonly push: PushService,
  ) {}

  /**
   * Tell whoever owns this conversation that a customer has written.
   *
   * Who "owns" it is the whole question. An assigned conversation notifies its
   * assignee — that's the notification people actually want. An unassigned one
   * sitting in a team queue notifies that team, but under a separate preference
   * that is off by default: a shared inbox that pushes every arrival to everyone
   * is how an app earns itself a permanently disabled notification setting.
   *
   * Fire-and-forget by construction — PushService never blocks ingest, and its
   * own rules (open thread, quiet hours, rate limit) decide what actually goes.
   */
  private async pushInbound(conversationId: string, authorName: string, preview: string): Promise<void> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv) return;
    const body = preview.trim().slice(0, 140) || "Sent an attachment";
    // In a group, who spoke matters as much as which group — a banner saying
    // only the sender's name gives no way to tell which chat it came from.
    const title =
      conv.channel === "whatsapp_group" ? `${authorName} · ${conv.contact.displayName}` : authorName;

    if (conv.assigneeUserId) {
      this.push.notify({
        userIds: [conv.assigneeUserId],
        kind: "message",
        title,
        body,
        conversationId,
      });
      return;
    }
    if (!conv.assignedTeamId) return;
    const members = await this.store.listMembers();
    const teamMembers = members.filter((m) => m.teamIds.includes(conv.assignedTeamId!)).map((m) => m.user.id);
    if (!teamMembers.length) return;
    this.push.notify({ userIds: teamMembers, kind: "team_message", title, body, conversationId });
  }

  async ingestWhatsApp(input: WhatsAppInbound): Promise<{ conversationId: string; created: boolean } | undefined> {
    // Idempotency: Meta retries any webhook it doesn't get a fast 2xx for, so a
    // message we've already stored must not be ingested twice.
    if (input.channelMsgId) {
      const seen = await this.store.getMessageRefByChannelId(input.channelMsgId);
      if (seen) return { conversationId: seen.conversationId, created: false };
    }

    const inbox = await this.store.getInboxByWhatsAppPhoneId(input.phoneNumberId);
    if (!inbox) {
      this.logger.warn(`No inbox mapped for WhatsApp phone id ${input.phoneNumberId}`);
      await this.store.recordWebhookDiagnostic({
        channel: "whatsapp",
        kind: "unmapped_inbox",
        reference: input.phoneNumberId,
        detail: `Inbound WhatsApp for an unmapped phone number id (from ${input.from})`,
      });
      return undefined;
    }

    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      // Record WhatsApp's wa_id (the sender's WhatsApp user id) as `wa_id`, not
      // `phone`, so identity stays anchored to the WhatsApp account if Meta
      // migrates to Business-Scoped IDs. Matching still unifies phone↔wa_id.
      kind: "wa_id",
      value: input.from,
      displayName: input.name || input.from,
    });
    if (contact.blocked) {
      this.logger.log(`Dropped inbound WhatsApp from blocked contact ${input.from}`);
      return undefined;
    }

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
      channel: "whatsapp",
      messageType: input.messageType,
      attachments: input.attachments,
      quotedMsgId: input.quotedMsgId,
      forwarded: input.forwarded,
    });
    if (message) {
      this.realtime.emitMessageCreated(conv.id, message, inbox.orgId);
      void this.pushInbound(conv.id, contact.displayName, input.text);
    }

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
    forwarded?: boolean;
  }): Promise<{ conversationId: string; created: boolean } | undefined> {
    if (input.channelMsgId) {
      const seen = await this.store.getMessageRefByChannelId(input.channelMsgId);
      if (seen) return { conversationId: seen.conversationId, created: false };
    }
    const conversationId = await this.store.findConversationByChannelRef(input.groupId);
    if (!conversationId) {
      this.logger.warn(`No group conversation for WhatsApp group ${input.groupId}`);
      await this.store.recordWebhookDiagnostic({
        channel: "whatsapp_group",
        kind: "unmapped_group",
        reference: input.groupId,
        detail: `Inbound WhatsApp group message for an unknown group (from ${input.from})`,
      });
      return undefined;
    }
    const conv = await this.store.getConversation(conversationId);
    const orgId = conv?.orgId ?? this.tenant.defaultOrgId;
    const contact = await this.store.upsertContactByIdentity({
      orgId,
      // Record WhatsApp's wa_id (the sender's WhatsApp user id) as `wa_id`, not
      // `phone`, so identity stays anchored to the WhatsApp account if Meta
      // migrates to Business-Scoped IDs. Matching still unifies phone↔wa_id.
      kind: "wa_id",
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
      channel: "whatsapp_group",
      messageType: input.messageType,
      attachments: input.attachments,
      quotedMsgId: input.quotedMsgId,
      forwarded: input.forwarded,
    });
    if (message) {
      this.realtime.emitMessageCreated(conversationId, message, orgId);
      void this.pushInbound(conversationId, contact.displayName, input.text);
    }
    return { conversationId, created: false };
  }

  async ingestEmail(input: EmailInbound): Promise<{ conversationId: string; created: boolean } | undefined> {
    // Idempotency: a Postmark/webhook retry of an email we've already stored
    // (matched on its own Message-ID) must not append a duplicate.
    if (input.messageId) {
      const seen = await this.store.getMessageRefByChannelId(input.messageId);
      if (seen) return { conversationId: seen.conversationId, created: false };
    }

    const inbox = await this.store.getInboxByEmailAddress(input.toAddress);
    if (!inbox) {
      this.logger.warn(`No inbox mapped for email address ${input.toAddress}`);
      await this.store.recordWebhookDiagnostic({
        channel: "email",
        kind: "unmapped_inbox",
        reference: input.toAddress,
        detail: `Inbound email to an unmanaged address (from ${input.from})`,
      });
      return undefined;
    }

    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      kind: "email",
      value: input.from.toLowerCase(),
      displayName: input.fromName || input.from,
    });
    if (contact.blocked) {
      this.logger.log(`Dropped inbound email from blocked contact ${input.from}`);
      return undefined;
    }

    // Thread onto an existing conversation via References/In-Reply-To first —
    // but only onto THIS contact's thread.
    //
    // Everyone on a CC list shares one References chain, so an unscoped lookup
    // files a CC'd recipient's Reply-All onto the original sender's
    // conversation: two customers, one thread, and an agent replying to the
    // wrong person. Scoping by contact means a new sender opens their own
    // conversation, which is what a shared inbox has to do.
    let conversationId = input.references?.length
      ? await this.store.findConversationByMessageChannelIds(input.references, { contactIds: [contact.id] })
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

    // Remember the latest inbound Gmail thread id on the conversation so an
    // outbound reply is sent back into that same server-side thread (Gmail only;
    // Postmark inbound carries no thread id and threads via headers alone).
    //
    // One thread id, one conversation. Gmail groups a CC'd person's Reply-All
    // into the *same* mailbox thread, so without this a second customer's
    // conversation would claim a thread the first one already owns — which puts
    // our replies to one of them into the other's thread, and makes the
    // channelRef lookup ambiguous. A conversation with no claim of its own
    // simply starts a fresh Gmail thread when we reply, which is correct.
    if (input.threadId) {
      const owner = await this.store.findConversationByChannelRef(input.threadId);
      if (!owner || owner === conversationId) {
        await this.store.setConversationChannelRef(conversationId, input.threadId);
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
      channel: "email",
      messageType: input.messageType,
      attachments: input.attachments,
    });
    if (message) {
      this.realtime.emitMessageCreated(conversationId, message, inbox.orgId);
      void this.pushInbound(conversationId, contact.displayName, input.text);
    }

    return { conversationId, created };
  }

  /**
   * Record a reply the agent sent straight from Gmail (not through Nest) onto its
   * conversation, so the thread stays complete. Resolves the thread by
   * References/In-Reply-To, then by the Gmail thread id; a reply to a thread Nest
   * has never seen is skipped.
   *
   * `recipients` is what makes that resolution safe. A Gmail thread started by
   * one customer can hold replies addressed to a different one — a CC'd person
   * the agent then answered — and both share the References chain and the thread
   * id. Without knowing who the mail was actually *to*, either lookup files the
   * agent's reply to Bob onto Alice's conversation. So the thread this belongs
   * to is the one whose customer is among the recipients; if none of them is a
   * customer we know, we record nothing rather than guess.
   */
  async ingestOutboundEmail(input: {
    subject?: string;
    text: string;
    html?: string;
    messageId?: string;
    references?: string[];
    threadId?: string;
    authorName?: string;
    /** Every address the agent sent to — To and Cc. */
    recipients?: string[];
    attachments?: AttachmentInput[];
  }): Promise<{ conversationId: string } | undefined> {
    // Already stored (Nest sent it, or a previous sync grabbed it) → nothing to do.
    if (input.messageId) {
      const seen = await this.store.getMessageRefByChannelId(input.messageId);
      if (seen) return { conversationId: seen.conversationId };
    }

    const contactIds = await this.recipientContactIds(input.recipients);
    // A message whose recipients we can't place is one we can't file safely.
    // Before scoping existed this fell through to an unscoped lookup, which is
    // precisely how a reply landed on the wrong customer's thread.
    if (input.recipients?.length && !contactIds.length) return undefined;
    const scope = contactIds.length ? { contactIds } : undefined;

    let conversationId = input.references?.length
      ? await this.store.findConversationByMessageChannelIds(input.references, scope)
      : undefined;
    if (!conversationId && input.threadId) {
      conversationId = await this.store.findConversationByChannelRef(input.threadId, scope);
    }
    if (!conversationId) return undefined;

    const { html: bodyHtml } = sanitizeEmailHtml(input.html);
    const message = await this.store.appendSyncedOutboundEmail(conversationId, {
      body: input.text,
      bodyHtml: bodyHtml || undefined,
      channelMsgId: input.messageId,
      authorName: input.authorName,
      attachments: input.attachments,
    });
    if (message) {
      const conv = await this.store.getConversation(conversationId);
      if (conv) {
        this.realtime.emitMessageCreated(conversationId, message, conv.orgId);
        this.realtime.emitConversationUpdated(conv);
      }
    }
    return { conversationId };
  }

  /**
   * Which of these addresses are customers we already know.
   *
   * Lookup only, never create: an agent's outgoing mail is addressed to
   * colleagues, suppliers and mailing lists as well as customers, and turning
   * every one of those into a contact would bury the customer list. An address
   * we don't recognise simply doesn't narrow the search.
   */
  private async recipientContactIds(recipients: string[] | undefined): Promise<string[]> {
    if (!recipients?.length) return [];
    const orgId = this.tenant.defaultOrgId;
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const address of recipients) {
      const value = address.trim().toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const contact = await this.store.findContactByIdentity({ orgId, kind: "email", value });
      if (contact && !ids.includes(contact.id)) ids.push(contact.id);
    }
    return ids;
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
