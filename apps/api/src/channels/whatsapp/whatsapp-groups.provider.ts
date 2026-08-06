import { Injectable, Logger } from "@nestjs/common";
import { env } from "../../config/env";
import { Store } from "../../data/store";

export interface GroupCreateResult {
  groupId: string;
  inviteLink: string;
}

interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * WhatsApp Groups API operations (create group, invite link, add/remove member)
 * for a specific hosting number. Credentials are resolved per inbox — a
 * Meta-connected number uses its own token/phone-number-id — falling back to the
 * global env creds. With neither, the operation is mocked so the whole flow
 * works with no live number. Groups are capped at 8 members by Meta.
 */
@Injectable()
export class WhatsAppGroupsProvider {
  private readonly logger = new Logger(WhatsAppGroupsProvider.name);

  constructor(private readonly store: Store) {}

  private slug(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8) || "group";
    return `${base}${Math.floor(Math.random() * 1e6)}`;
  }

  /** The hosting number's own credentials (Meta-connected) or the global env ones. */
  private async credsFor(inboxId: string): Promise<WhatsAppCreds | null> {
    const config = await this.store.getInboxConfig(inboxId);
    if (config?.phoneNumberId && config?.accessToken) {
      return { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken };
    }
    if (env.whatsapp.phoneNumberId && env.whatsapp.token) {
      return { phoneNumberId: env.whatsapp.phoneNumberId, accessToken: env.whatsapp.token };
    }
    return null;
  }

  async createGroup(inboxId: string, name: string, memberPhones: string[]): Promise<GroupCreateResult> {
    const creds = await this.credsFor(inboxId);
    if (!creds) {
      const groupId = `wag.mock_${Date.now()}`;
      const inviteLink = `https://chat.whatsapp.com/NC${this.slug(name)}`;
      this.logger.log(`[mock] Created WhatsApp group "${name}" (${memberPhones.length} members) → ${inviteLink}`);
      return { groupId, inviteLink };
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/groups`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: name, participants: memberPhones }),
    });
    const json = (await res.json()) as { id?: string; invite_link?: string };
    return { groupId: json.id ?? "", inviteLink: json.invite_link ?? "" };
  }

  async addParticipant(inboxId: string, groupId: string, phone: string): Promise<boolean> {
    const creds = await this.credsFor(inboxId);
    if (!creds) {
      this.logger.log(`[mock] Add ${phone} to group ${groupId}`);
      return true;
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${groupId}/participants`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ participants: [phone] }),
    });
    return res.ok;
  }

  async removeParticipant(inboxId: string, groupId: string, phone: string): Promise<boolean> {
    const creds = await this.credsFor(inboxId);
    if (!creds) {
      this.logger.log(`[mock] Remove ${phone} from group ${groupId}`);
      return true;
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${groupId}/participants`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ participants: [phone] }),
    });
    return res.ok;
  }
}
