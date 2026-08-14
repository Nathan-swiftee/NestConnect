import { Injectable, Logger } from "@nestjs/common";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import { metaErrorMessage, resolveWhatsAppCreds } from "./whatsapp-creds";

export interface GroupCreateResult {
  groupId: string;
  inviteLink: string;
}

/**
 * WhatsApp Groups API (Meta Business Platform) operations for a hosting number.
 *
 * The real Groups API is invite-only: you create a group with a subject, then
 * SHARE its invite link — people JOIN via the link (the business approves the
 * request), which Meta reports back on the `group_participants_update` webhook.
 * There is deliberately no "add a participant by phone" endpoint, so we don't
 * pretend to have one. A group holds at most 8 participants.
 *
 * Groups require the number to be an Official Business Account (OBA); on a
 * non-OBA number Meta rejects these calls, and the error is surfaced upward.
 * Credentials are resolved per inbox (the number's own token), falling back to
 * the global env creds; with neither, every call is mocked so the whole flow is
 * still exercisable in dev/CI without a live OBA number.
 *
 * Endpoints (Graph API):
 *   create group      POST   /{phone-number-id}/groups        { subject }
 *   invite link       POST   /{group-id}/invite_link          → { invite_link }
 *   revoke link       DELETE /{group-id}/invite_link
 *   remove participant DELETE /{group-id}/participants         { participants }
 *   delete group      DELETE /{group-id}
 */
@Injectable()
export class WhatsAppGroupsProvider {
  private readonly logger = new Logger(WhatsAppGroupsProvider.name);

  constructor(private readonly store: Store) {}

  private base(idOrPath: string): string {
    return `https://graph.facebook.com/${env.whatsapp.apiVersion}/${idOrPath}`;
  }

  private slug(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8) || "group";
    // A deterministic-ish suffix for the mock link (no Math.random needed).
    return `${base}${name.length}${base.length}`;
  }

  private creds(inboxId: string) {
    return resolveWhatsAppCreds(this.store, inboxId);
  }

  /**
   * Create a group (subject only — members join later via the invite link) and
   * fetch its shareable invite link. Returns the Meta group id + invite link.
   */
  async createGroup(inboxId: string, name: string): Promise<GroupCreateResult> {
    const creds = await this.creds(inboxId);
    if (!creds) {
      const groupId = `wag.mock_${this.slug(name)}`;
      const inviteLink = `https://chat.whatsapp.com/NC${this.slug(name)}`;
      this.logger.log(`[mock] Created WhatsApp group "${name}" → ${inviteLink}`);
      return { groupId, inviteLink };
    }

    const res = await fetch(this.base(`${creds.phoneNumberId}/groups`), {
      method: "POST",
      headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", subject: name }),
    });
    const json = (await res.json()) as {
      id?: string;
      groups?: Array<{ id?: string }>;
      error?: unknown;
    };
    if (!res.ok) {
      throw new Error(metaErrorMessage(json.error, res.status));
    }
    const groupId = json.id ?? json.groups?.[0]?.id ?? "";
    const inviteLink = groupId ? await this.inviteLink(creds.accessToken, groupId) : "";
    this.logger.log(`Created WhatsApp group "${name}" (${groupId})`);
    return { groupId, inviteLink };
  }

  /** Fetch (creating if needed) a group's current invite link. */
  private async inviteLink(accessToken: string, groupId: string): Promise<string> {
    const res = await fetch(this.base(`${groupId}/invite_link`), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp" }),
    });
    const json = (await res.json()) as { invite_link?: string; error?: unknown };
    if (!res.ok) {
      this.logger.warn(`Group invite link failed: ${JSON.stringify(json.error ?? json)}`);
      return "";
    }
    return json.invite_link ?? "";
  }

  /**
   * Revoke the current invite link and mint a fresh one (used when a link leaks
   * or has been shared too widely). Returns the new link.
   */
  async resetInviteLink(inboxId: string, groupId: string): Promise<string> {
    const creds = await this.creds(inboxId);
    if (!creds) {
      const link = `https://chat.whatsapp.com/NC${this.slug(groupId)}`;
      this.logger.log(`[mock] Reset invite link for ${groupId} → ${link}`);
      return link;
    }
    // Revoke the old link, then request a new one.
    await fetch(this.base(`${groupId}/invite_link`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${creds.accessToken}` },
    }).catch(() => undefined);
    return this.inviteLink(creds.accessToken, groupId);
  }

  /**
   * Remove a participant from a group. Meta processes the removal asynchronously
   * and confirms it on the `group_participants_update` webhook. Returns whether
   * the request was accepted.
   */
  async removeParticipant(inboxId: string, groupId: string, phone: string): Promise<boolean> {
    const creds = await this.creds(inboxId);
    if (!creds) {
      this.logger.log(`[mock] Remove ${phone} from group ${groupId}`);
      return true;
    }
    const res = await fetch(this.base(`${groupId}/participants`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", participants: [phone] }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.warn(`Group remove-participant failed (${res.status}): ${detail}`);
    }
    return res.ok;
  }

  /**
   * Delete a group. Meta requires all other members to be removed first, so this
   * is a last step after clearing participants. (Not yet surfaced in the UI —
   * kept here so the management surface is complete for when OBA lands.)
   */
  async deleteGroup(inboxId: string, groupId: string): Promise<boolean> {
    const creds = await this.creds(inboxId);
    if (!creds) {
      this.logger.log(`[mock] Delete group ${groupId}`);
      return true;
    }
    const res = await fetch(this.base(groupId), {
      method: "DELETE",
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    return res.ok;
  }
}
