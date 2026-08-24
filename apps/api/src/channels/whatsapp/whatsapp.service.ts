import { Injectable, Logger } from "@nestjs/common";
import type { AttachmentKind, MessageStatus, MessageType } from "@ding/schemas";
import { env } from "../../config/env";
import { Store, type AttachmentInput } from "../../data/store";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { MediaService } from "../../storage/media.service";
import { IngestService } from "../ingest.service";
import { GroupsService } from "../groups/groups.service";

/** A WhatsApp media object as it appears on an inbound message. */
interface WaMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

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
        messages?: Array<{
          from: string;
          id: string;
          type?: string;
          group_id?: string;
          text?: { body?: string };
          image?: WaMedia;
          video?: WaMedia;
          audio?: WaMedia;
          document?: WaMedia;
          sticker?: WaMedia;
          /** An emoji reaction to an earlier message (empty emoji = removed). */
          reaction?: { message_id?: string; emoji?: string };
          /** `id` is the message this one quotes (a reply); `forwarded` is set
           *  when the sender passed it on from another chat instead of writing it. */
          context?: { id?: string; forwarded?: boolean };
        }>;
        statuses?: Array<{
          id: string;
          status?: string;
          recipient_id?: string;
          /** Present on a `failed` status — Meta's reason (e.g. 131052 "Media
           *  download error"). This is why a message that sent fine can still
           *  show "this media is no longer available" on the recipient's phone. */
          errors?: Array<{ code?: number; title?: string; error_data?: { details?: string } }>;
        }>;
        participants?: Array<{ wa_id?: string; user?: string; action?: string; profile?: { name?: string } }>;
      };
    }>;
  }>;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly ingest: IngestService,
    private readonly groups: GroupsService,
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
    private readonly media: MediaService,
  ) {}

  async handleWebhook(
    body: WhatsAppWebhookBody,
  ): Promise<{ messages: number; statuses: number; groupEvents: number; reactions: number }> {
    let messages = 0;
    let statuses = 0;
    let groupEvents = 0;
    let reactions = 0;

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
          // Isolate each message: a single failure (DB blip, media error) must
          // log-and-continue, never throw the whole batch back to Meta as a 500
          // — that would retry messages that already succeeded.
          try {
            // A reaction updates an existing message (emoji) rather than adding one.
            if (msg.type === "reaction" || msg.reaction) {
              const target = msg.reaction?.message_id;
              if (target) {
                const ref = await this.store.getMessageRefByChannelId(target);
                if (ref) {
                  const updated = await this.store.reactToMessage(ref.id, msg.reaction?.emoji ?? "", "contact");
                  if (updated) {
                    this.realtime.emitMessageUpdated(updated.conversationId, updated.message);
                    reactions += 1;
                  }
                }
              }
              continue;
            }

            const groupId = valueGroupId ?? msg.group_id;
            const { text, messageType, attachments } = await this.resolveInbound(msg, phoneNumberId);
            // Resolve a reply's quoted message to our internal id (when we have it).
            const quotedMsgId = msg.context?.id
              ? (await this.store.getMessageRefByChannelId(msg.context.id))?.id
              : undefined;
            // Meta only sets this when the sender forwarded the message to us.
            const forwarded = msg.context?.forwarded === true;
            const res = groupId
              ? await this.ingest.ingestWhatsAppGroup({
                  groupId,
                  from: msg.from,
                  name: nameOf(msg.from),
                  text,
                  channelMsgId: msg.id,
                  messageType,
                  attachments,
                  quotedMsgId,
                  forwarded,
                })
              : await this.ingest.ingestWhatsApp({
                  phoneNumberId,
                  from: msg.from,
                  name: nameOf(msg.from),
                  text,
                  channelMsgId: msg.id,
                  messageType,
                  attachments,
                  quotedMsgId,
                  forwarded,
                });
            if (res) messages += 1;
          } catch (err) {
            this.logger.error(`Failed to ingest WhatsApp message ${msg.id}: ${String(err)}`);
          }
        }

        for (const st of value.statuses ?? []) {
          try {
            // Meta reports WHY a message failed here — the decisive signal for a
            // send that we accepted but the recipient can't open (media download
            // errors, test-number limits, etc.).
            if (st.errors?.length) {
              const e = st.errors[0];
              this.logger.warn(
                `WhatsApp delivery failed for ${st.id}: code=${e.code} title="${e.title ?? ""}" details="${e.error_data?.details ?? ""}"`,
              );
            }
            const status = this.mapStatus(st.status);
            if (!status) continue;
            const updated = await this.store.updateMessageStatusByChannelId(st.id, status);
            if (updated) {
              this.realtime.emitMessageUpdated(updated.conversationId, updated.message);
              statuses += 1;
            }
          } catch (err) {
            this.logger.warn(`Failed to apply WhatsApp status ${st.id}: ${String(err)}`);
          }
        }
      }
    }
    return { messages, statuses, groupEvents, reactions };
  }

  /**
   * Turn an inbound message into body text + type + any stored attachment.
   * Media is downloaded from Meta with the number's token and stored; if that
   * isn't possible (no token / mock / error) we fall back to a text placeholder
   * so the message still lands.
   */
  private async resolveInbound(
    msg: { type?: string; text?: { body?: string }; image?: WaMedia; video?: WaMedia; audio?: WaMedia; document?: WaMedia; sticker?: WaMedia },
    phoneNumberId: string,
  ): Promise<{ text: string; messageType: MessageType; attachments?: AttachmentInput[] }> {
    const found = extractMedia(msg);
    if (!found) {
      const text = msg.text?.body ?? (msg.type && msg.type !== "text" ? `[${msg.type} message]` : "");
      return { text, messageType: "text" };
    }
    const { media, kind, type } = found;
    const token = await this.tokenFor(phoneNumberId);
    let attachment: AttachmentInput | null = null;
    if (token) {
      const url = await this.resolveMediaUrl(media.id, token);
      if (url) {
        attachment = await this.media.downloadAndStore(url, {
          authToken: token,
          mime: media.mime_type,
          kind,
          filename: media.filename,
        });
      }
    }
    if (attachment) {
      return { text: media.caption ?? "", messageType: type, attachments: [attachment] };
    }
    this.logger.warn(`WhatsApp media ${media.id} not stored — placeholder used`);
    return { text: media.caption || `[${msg.type} message]`, messageType: "text" };
  }

  /** Resolve a media id to its (short-lived, token-protected) download URL. */
  private async resolveMediaUrl(mediaId: string, token: string): Promise<string | null> {
    try {
      const res = await fetch(`https://graph.facebook.com/${env.whatsapp.apiVersion}/${mediaId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { url?: string };
      return json.url ?? null;
    } catch {
      return null;
    }
  }

  /** The receiving number's access token (per-inbox, else the global env one). */
  private async tokenFor(phoneNumberId: string): Promise<string | null> {
    const inbox = await this.store.getInboxByWhatsAppPhoneId(phoneNumberId);
    if (inbox) {
      const cfg = await this.store.getInboxConfig(inbox.id);
      if (cfg?.accessToken) return cfg.accessToken;
    }
    return env.whatsapp.token || null;
  }

  private mapStatus(s?: string): MessageStatus | undefined {
    return s === "sent" || s === "delivered" || s === "read" || s === "failed" ? s : undefined;
  }
}

/** Pull the media object off an inbound message, with its kind + message type. */
function extractMedia(msg: {
  image?: WaMedia;
  video?: WaMedia;
  audio?: WaMedia;
  document?: WaMedia;
  sticker?: WaMedia;
}): { media: WaMedia; kind: AttachmentKind; type: MessageType } | null {
  if (msg.image) return { media: msg.image, kind: "image", type: "image" };
  if (msg.sticker) return { media: msg.sticker, kind: "sticker", type: "sticker" };
  if (msg.video) return { media: msg.video, kind: "video", type: "video" };
  if (msg.audio)
    return { media: msg.audio, kind: msg.audio.voice ? "voice" : "audio", type: msg.audio.voice ? "voice" : "audio" };
  if (msg.document) return { media: msg.document, kind: "document", type: "document" };
  return null;
}
