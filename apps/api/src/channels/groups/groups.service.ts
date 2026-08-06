import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  GROUP_MAX_MEMBERS,
  type AddParticipantInput,
  type Contact,
  type ConversationWithMessages,
  type CreateGroupInput,
  type Participant,
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

  /** Create an official WhatsApp group space (≤8 members) and route it. */
  async createGroup(input: CreateGroupInput): Promise<ConversationWithMessages> {
    // A WhatsApp group is hosted BY a WhatsApp number (the business number is a
    // member of the group) — not a channel of its own.
    const inbox = (await this.store.listInboxes()).find((i) => i.id === input.inboxId);
    if (!inbox || inbox.type !== "whatsapp") {
      throw new BadRequestException("inboxId must be a WhatsApp number");
    }
    if (input.members.length > GROUP_MAX_MEMBERS) {
      throw new BadRequestException(`A WhatsApp group allows at most ${GROUP_MAX_MEMBERS} members`);
    }

    const { groupId, inviteLink } = await this.provider.createGroup(
      inbox.id,
      input.name,
      input.members.map((m) => m.phone),
    );

    const groupContact = await this.store.createContact({
      orgId: inbox.orgId,
      displayName: input.name,
      avatarColor: GROUP_AVATAR,
    });

    const memberContacts: Contact[] = [];
    for (const m of input.members) {
      memberContacts.push(
        await this.store.upsertContactByIdentity({
          orgId: inbox.orgId,
          kind: "phone",
          value: m.phone,
          displayName: m.name || m.phone,
        }),
      );
    }

    const conversation = await this.store.createGroupConversation({
      orgId: inbox.orgId,
      inboxId: inbox.id,
      contact: groupContact,
      subject: input.name,
      channelRef: groupId,
      inviteLink,
      memberContacts,
    });

    const decision = await this.routing.route(inbox, groupContact);
    const assigned = await this.store.assign(conversation.id, decision);
    this.realtime.emitConversationAssigned(assigned ?? conversation, "group-created");

    const full = await this.store.getConversation(conversation.id);
    if (!full) throw new NotFoundException("Group conversation not found after creation");
    this.logger.log(`Created group "${input.name}" (${memberContacts.length} members) → ${inviteLink}`);
    return full;
  }

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv || conv.channel !== "whatsapp_group") throw new NotFoundException("Group not found");
    if ((await this.store.countParticipants(conversationId)) >= GROUP_MAX_MEMBERS) {
      throw new BadRequestException(`A WhatsApp group allows at most ${GROUP_MAX_MEMBERS} members`);
    }
    if (conv.channelRef) await this.provider.addParticipant(conv.inboxId, conv.channelRef, input.phone);

    const contact = await this.store.upsertContactByIdentity({
      orgId: conv.orgId,
      kind: "phone",
      value: input.phone,
      displayName: input.name || input.phone,
    });
    const participant = await this.store.addParticipant(conversationId, contact);
    await this.emitUpdated(conversationId);
    return participant;
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

  /** Apply a group_participants_update webhook (member joined/left). */
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
