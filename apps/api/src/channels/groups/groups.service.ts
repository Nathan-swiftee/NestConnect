import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  GROUP_MAX_MEMBERS,
  type ConversationWithMessages,
  type CreateGroupInput,
} from "@ding/schemas";
import { Store } from "../../data/store";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { RoutingService } from "../routing.service";
import { WhatsAppGroupsProvider } from "../whatsapp/whatsapp-groups.provider";

const GROUP_AVATAR = "linear-gradient(135deg,#6366F1,#A855F7)";

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly store: Store,
    private readonly provider: WhatsAppGroupsProvider,
    private readonly routing: RoutingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Create an official WhatsApp group (≤8 members) hosted by a WhatsApp number.
   * The Groups API is invite-only: we create the group with a subject and share
   * its invite link — members JOIN via the link (there's no add-by-phone), and
   * the `group_participants_update` webhook fills the roster in as they do.
   */
  async createGroup(input: CreateGroupInput): Promise<ConversationWithMessages> {
    // A WhatsApp group is hosted BY a WhatsApp number (the business number is a
    // member of the group) — not a channel of its own.
    const inbox = (await this.store.listInboxes()).find((i) => i.id === input.inboxId);
    if (!inbox || inbox.type !== "whatsapp") {
      throw new BadRequestException("inboxId must be a WhatsApp number");
    }

    const { groupId, inviteLink } = await this.provider.createGroup(inbox.id, input.name);

    const groupContact = await this.store.createContact({
      orgId: inbox.orgId,
      displayName: input.name,
      avatarColor: GROUP_AVATAR,
    });

    const conversation = await this.store.createGroupConversation({
      orgId: inbox.orgId,
      inboxId: inbox.id,
      contact: groupContact,
      subject: input.name,
      channelRef: groupId,
      inviteLink,
      // Invite-only: nobody is in the group until they join via the link.
      memberContacts: [],
    });

    const decision = await this.routing.route(inbox, groupContact);
    const assigned = await this.store.assign(conversation.id, decision);
    this.realtime.emitConversationAssigned(assigned ?? conversation, "group-created");

    const full = await this.store.getConversation(conversation.id);
    if (!full) throw new NotFoundException("Group conversation not found after creation");
    this.logger.log(`Created group "${input.name}" → ${inviteLink}`);
    return full;
  }

  /** Revoke a group's invite link and mint a fresh one (e.g. if the link leaks). */
  async resetInviteLink(conversationId: string): Promise<{ inviteLink: string }> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv || conv.channel !== "whatsapp_group") throw new NotFoundException("Group not found");
    if (!conv.channelRef) throw new BadRequestException("This group has no WhatsApp id yet");
    const inviteLink = await this.provider.resetInviteLink(conv.inboxId, conv.channelRef);
    await this.store.setInviteLink(conversationId, inviteLink);
    await this.emitUpdated(conversationId);
    return { inviteLink };
  }

  async removeParticipant(conversationId: string, contactId: string): Promise<void> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv || conv.channel !== "whatsapp_group") throw new NotFoundException("Group not found");
    const target = conv.participants.find((p) => p.contact.id === contactId);
    if (conv.channelRef && target?.contact.phone) {
      await this.provider.removeParticipant(conv.inboxId, conv.channelRef, target.contact.phone);
    }
    await this.store.removeParticipant(conversationId, contactId);
    await this.emitUpdated(conversationId);
  }

  /** Apply a group_participants_update webhook (member joined via link / left). */
  async handleParticipantEvent(groupId: string, action: "add" | "remove", phone: string, name?: string): Promise<void> {
    const conversationId = await this.store.findConversationByChannelRef(groupId);
    if (!conversationId) return;
    if (action === "add") {
      if ((await this.store.countParticipants(conversationId)) >= GROUP_MAX_MEMBERS) return;
      const conv = await this.store.getConversation(conversationId);
      const contact = await this.store.upsertContactByIdentity({
        orgId: conv?.orgId ?? "org_swiftee",
        kind: "phone",
        value: phone,
        displayName: name || phone,
      });
      await this.store.addParticipant(conversationId, contact);
    } else {
      const parts = await this.store.listParticipants(conversationId);
      const target = parts.find((p) => p.contact.phone === phone);
      if (target) await this.store.removeParticipant(conversationId, target.contact.id);
    }
    await this.emitUpdated(conversationId);
  }

  private async emitUpdated(conversationId: string): Promise<void> {
    const full = await this.store.getConversation(conversationId);
    if (full) this.realtime.emitConversationUpdated(full);
  }
}
