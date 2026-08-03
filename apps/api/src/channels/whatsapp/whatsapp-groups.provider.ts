import { Injectable, Logger } from "@nestjs/common";
import { env } from "../../config/env";

export interface GroupCreateResult {
  groupId: string;
  inviteLink: string;
}

/**
 * WhatsApp Groups API operations (create group, invite link, add/remove member).
 * Mock by default so the whole flow works with no live number; live mode calls
 * the Graph API group endpoints. Groups are capped at 8 members by Meta.
 */
@Injectable()
export class WhatsAppGroupsProvider {
  private readonly logger = new Logger(WhatsAppGroupsProvider.name);

  private get isLive(): boolean {
    return env.whatsappLive;
  }

  private slug(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8) || "group";
    return `${base}${Math.floor(Math.random() * 1e6)}`;
  }

  async createGroup(name: string, memberPhones: string[]): Promise<GroupCreateResult> {
    if (!this.isLive) {
      const groupId = `wag.mock_${Date.now()}`;
      const inviteLink = `https://chat.whatsapp.com/DING${this.slug(name)}`;
      this.logger.log(`[mock] Created WhatsApp group "${name}" (${memberPhones.length} members) → ${inviteLink}`);
      return { groupId, inviteLink };
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/groups`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.whatsapp.token}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: name, participants: memberPhones }),
    });
    const json = (await res.json()) as { id?: string; invite_link?: string };
    return { groupId: json.id ?? "", inviteLink: json.invite_link ?? "" };
  }

  async addParticipant(groupId: string, phone: string): Promise<boolean> {
    if (!this.isLive) {
      this.logger.log(`[mock] Add ${phone} to group ${groupId}`);
      return true;
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${groupId}/participants`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.whatsapp.token}`, "content-type": "application/json" },
      body: JSON.stringify({ participants: [phone] }),
    });
    return res.ok;
  }

  async removeParticipant(groupId: string, phone: string): Promise<boolean> {
    if (!this.isLive) {
      this.logger.log(`[mock] Remove ${phone} from group ${groupId}`);
      return true;
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${groupId}/participants`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${env.whatsapp.token}`, "content-type": "application/json" },
      body: JSON.stringify({ participants: [phone] }),
    });
    return res.ok;
  }
}
