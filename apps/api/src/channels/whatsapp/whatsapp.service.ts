import { Injectable } from "@nestjs/common";
import type { MessageStatus } from "@ding/schemas";
import { Store } from "../../data/store";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { IngestService } from "../ingest.service";
import { GroupsService } from "../groups/groups.service";

/* Minimal shape of the Meta WhatsApp Cloud API webhook payload we consume. */
export interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string; group_id?: string };
        group_id?: string;
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{ from: string; id: string; type?: string; group_id?: string; text?: { body?: string } }>;
        statuses?: Array<{ id: string; status?: string; recipient_id?: string }>;
        participants?: Array<{ wa_id?: string; user?: string; action?: string; profile?: { name?: string } }>;
      };
    }>;
  }>;
}

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly ingest: IngestService,
    private readonly groups: GroupsService,
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
  ) {}

  async handleWebhook(body: WhatsAppWebhookBody): Promise<{ messages: number; statuses: number; groupEvents: number }> {
    let messages = 0;
    let statuses = 0;
    let groupEvents = 0;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const phoneNumberId = value.metadata?.phone_number_id ?? "";
        const valueGroupId = value.metadata?.group_id ?? value.group_id;
        const nameOf = (waId: string) => value.contacts?.find((c) => c.wa_id === waId)?.profile?.name;

        // Group membership changes (someone joined/left via the invite link).
        if (change.field === "group_participants_update" && value.group_id && value.participants) {
          for (const p of value.participants) {
            const phone = p.wa_id ?? p.user ?? "";
            if (!phone) continue;
            await this.groups.handleParticipantEvent(
              value.group_id,
              p.action === "remove" ? "remove" : "add",
              phone,
              p.profile?.name,
            );
            groupEvents += 1;
          }
          continue;
        }

        for (const msg of value.messages ?? []) {
          const text = msg.text?.body ?? (msg.type ? `[${msg.type} message]` : "");
          const groupId = valueGroupId ?? msg.group_id;
          const res = groupId
            ? await this.ingest.ingestWhatsAppGroup({
                groupId,
                from: msg.from,
                name: nameOf(msg.from),
                text,
                channelMsgId: msg.id,
              })
            : await this.ingest.ingestWhatsApp({
                phoneNumberId,
                from: msg.from,
                name: nameOf(msg.from),
                text,
                channelMsgId: msg.id,
              });
          if (res) messages += 1;
        }

        for (const st of value.statuses ?? []) {
          const status = this.mapStatus(st.status);
          if (!status) continue;
          const updated = await this.store.updateMessageStatusByChannelId(st.id, status);
          if (updated) {
            this.realtime.emitMessageUpdated(updated.conversationId, updated.message);
            statuses += 1;
          }
        }
      }
    }
    return { messages, statuses, groupEvents };
  }

  private mapStatus(s?: string): MessageStatus | undefined {
    return s === "sent" || s === "delivered" || s === "read" || s === "failed" ? s : undefined;
  }
}
