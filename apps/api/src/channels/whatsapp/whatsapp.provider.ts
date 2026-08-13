import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { AttachmentKind, ChannelType, Conversation } from "@ding/schemas";
import { env } from "../../config/env";
import { Store } from "../../data/store";
import {
  ChannelProvider,
  type OutboundMedia,
  type OutboundTemplate,
  type SendParams,
  type SendResult,
} from "../channel-provider";

interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
}

/** WhatsApp media message type for our attachment kind. */
type WaMediaType = "image" | "video" | "audio" | "document" | "sticker";
function waMediaType(kind: AttachmentKind): WaMediaType {
  switch (kind) {
    case "image": return "image";
    case "video": return "video";
    case "voice":
    case "audio": return "audio";
    case "sticker": return "sticker";
    default: return "document";
  }
}
/** Only image/video/document carry a caption on WhatsApp. */
function captionable(type: WaMediaType): boolean {
  return type === "image" || type === "video" || type === "document";
}

/**
 * The MIME type to declare when uploading media bytes to Meta's `/media`
 * endpoint. WhatsApp accepts only a fixed set of types, and a voice note must be
 * OGG/OPUS. Browser `MediaRecorder` emits Opus inside `audio/webm;codecs=opus`
 * (Chromium) or `audio/ogg;codecs=opus` (Firefox); Meta rejects both the codec
 * parameter and the WebM container, so an agent's recorded voice note never
 * delivers. Fold voice/opus audio to bare `audio/ogg` and strip codec
 * parameters from every type so Meta's allow-list matches.
 */
function whatsappUploadMime(item: OutboundMedia): string {
  const base = item.mime.split(";")[0].trim().toLowerCase();
  if (item.kind === "voice" || base === "audio/ogg" || base === "audio/webm") return "audio/ogg";
  return base;
}

/**
 * WhatsApp-playable audio MIME types for an `audio` message. A voice note must
 * be `audio/ogg` (Opus); mp4/aac/mpeg/amr render as a plain audio message. WebM
 * is deliberately absent — WhatsApp can't play it, so WebM has to be transcoded.
 */
const WA_PLAYABLE_AUDIO = new Set(["audio/ogg", "audio/mp4", "audio/aac", "audio/mpeg", "audio/amr"]);

/**
 * Sniff the audio container from the leading magic bytes (authoritative — the
 * recorder sometimes mislabels the MIME), falling back to the declared type. An
 * Ogg file opens with `OggS`; a WebM/Matroska file opens with the EBML magic
 * `1A 45 DF A3`. Everything else — notably iOS Safari's MP4/AAC — reads as
 * "other". Only "ogg" is sendable straight to WhatsApp as a voice note; the rest
 * must be transcoded first.
 */
function audioContainer(bytes: Buffer | undefined, mime: string): "ogg" | "webm" | "other" {
  if (bytes && bytes.length >= 4) {
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "ogg";
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  }
  const m = mime.toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  return "other";
}

/** First bytes as hex — lets a log line reveal the true container: `4f676753`
 *  = "OggS", `1a45dfa3` = WebM/EBML, `....66747970` = MP4 "ftyp" box. */
function headHex(bytes: Buffer | undefined, n = 16): string {
  return bytes && bytes.length ? Buffer.from(bytes.subarray(0, n)).toString("hex") : "(empty)";
}

/**
 * WhatsApp Business Platform (Cloud API) sender. Credentials are resolved per
 * inbox — a number connected via Meta carries its own token/phone-number-id in
 * channelConfig — falling back to the global env credentials. With neither, the
 * send is mocked so the whole path is exercisable in dev/CI without a live number.
 *
 * Media is sent by first uploading the bytes to `/{phone-number-id}/media` for a
 * media id, then sending a typed (image/video/audio/document) message. WhatsApp
 * carries one media object per message, so multiple attachments become multiple
 * messages; the caption rides the first captionable one.
 */
@Injectable()
export class WhatsAppCloudProvider extends ChannelProvider {
  private readonly logger = new Logger(WhatsAppCloudProvider.name);

  constructor(private readonly store: Store) {
    super();
  }

  supports(channel: ChannelType): boolean {
    return channel === "whatsapp" || channel === "whatsapp_group";
  }

  /** Tell WhatsApp the customer's message was read → blue ticks on their side. */
  async markRead(params: { conversation: Conversation; channelMsgId: string }): Promise<void> {
    await this.readReceipt(params.conversation.inboxId, params.channelMsgId, false);
  }

  /** Show the customer a "typing…" indicator (rides on the read receipt; ~25s). */
  async sendTyping(params: { conversation: Conversation; channelMsgId: string }): Promise<void> {
    await this.readReceipt(params.conversation.inboxId, params.channelMsgId, true);
  }

  /** React to a message with an emoji (empty string removes our reaction). */
  async sendReaction(params: {
    conversation: Conversation;
    channelMsgId: string;
    emoji: string;
  }): Promise<void> {
    const creds = await this.credsFor(params.conversation.inboxId);
    if (!creds) {
      this.logger.log(`[mock] WhatsApp reaction "${params.emoji || "(removed)"}" on ${params.channelMsgId}`);
      return;
    }
    const to = params.conversation.contact.phone;
    if (!to) return;
    await this.postMessage(creds, {
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: params.channelMsgId, emoji: params.emoji },
    });
  }

  /**
   * Mark an inbound message read, optionally with a typing indicator. Meta folds
   * both into one call: `status:read` (+ `typing_indicator` for the "typing…"
   * bubble), keyed on the customer's message id.
   */
  private async readReceipt(inboxId: string, channelMsgId: string, typing: boolean): Promise<void> {
    const what = typing ? "typing indicator" : "read receipt";
    const creds = await this.credsFor(inboxId);
    if (!creds) {
      this.logger.log(`[mock] WhatsApp ${what} for ${channelMsgId}`);
      return;
    }
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: channelMsgId,
          ...(typing ? { typing_indicator: { type: "text" } } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.warn(`WhatsApp ${what} failed (${res.status}): ${detail}`);
      }
    } catch (err) {
      this.logger.warn(`WhatsApp ${what} error: ${String(err)}`);
    }
  }

  async sendText(params: SendParams): Promise<SendResult> {
    // Use the sending inbox (may differ from the conversation's for a
    // cross-channel reply) to resolve this number's credentials.
    const creds = await this.credsFor(params.inboxId ?? params.conversation.inboxId);
    const media = params.media ?? [];
    if (!creds) {
      // No live credentials for this number. In production (and by default) this
      // is a real, non-retryable failure the agent must see; only the explicit
      // dev flag fakes a successful send.
      if (!env.mockMessaging) {
        return {
          ok: false,
          retryable: false,
          error: "WhatsApp number is not connected (missing access token / phone-number-id)",
          errorCode: "not_connected",
        };
      }
      const what = params.template
        ? `template "${params.template.name}" [${params.template.params.join(", ")}]`
        : media.length
          ? `${media.length} media + "${params.body}"`
          : params.body;
      this.logger.log(`[mock] WhatsApp → ${params.to}: ${what}`);
      return { ok: true, channelMsgId: `wamid.mock_${Date.now()}`, simulated: true };
    }
    if (params.template) return this.sendTemplateMessage(creds, params.to, params.template);
    return media.length ? this.sendWithMedia(creds, params, media) : this.sendTextOnly(creds, params);
  }

  /** Send an approved template (type:template) with its body variables filled. */
  private async sendTemplateMessage(
    creds: WhatsAppCreds,
    to: string,
    tpl: OutboundTemplate,
  ): Promise<SendResult> {
    const components = tpl.params.length
      ? [{ type: "body", parameters: tpl.params.map((text) => ({ type: "text", text })) }]
      : [];
    return this.postMessage(creds, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: tpl.name, language: { code: tpl.language }, components },
    });
  }

  private async sendTextOnly(creds: WhatsAppCreds, params: SendParams): Promise<SendResult> {
    return this.postMessage(creds, {
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      // Quote the message being replied to, so it renders as a WhatsApp reply.
      ...(params.replyToChannelMsgId ? { context: { message_id: params.replyToChannelMsgId } } : {}),
      text: { body: params.body },
    });
  }

  private async sendWithMedia(
    creds: WhatsAppCreds,
    params: SendParams,
    media: OutboundMedia[],
  ): Promise<SendResult> {
    let firstId: string | undefined;
    let firstError: string | undefined;
    let captionUsed = false;

    for (const item of media) {
      const mediaId = await this.uploadMedia(creds, item);
      if (!mediaId) {
        firstError ??= `upload failed for ${item.filename}`;
        continue;
      }
      const type = waMediaType(item.kind);
      const obj: Record<string, unknown> = { id: mediaId };
      // Ride the text body on the first captionable media, once.
      if (!captionUsed && params.body && captionable(type)) {
        obj.caption = params.body;
        captionUsed = true;
      }
      if (type === "document") obj.filename = item.filename;
      const res = await this.postMessage(creds, {
        messaging_product: "whatsapp",
        to: params.to,
        type,
        [type]: obj,
      });
      if (res.ok) firstId ??= res.channelMsgId;
      else firstError ??= res.error;
    }

    // If the caption never landed (e.g. only a voice note), send the text separately.
    if (params.body && !captionUsed) {
      const res = await this.sendTextOnly(creds, params);
      if (res.ok) firstId ??= res.channelMsgId;
      else firstError ??= res.error;
    }

    if (firstId) return { ok: true, channelMsgId: firstId, simulated: false };
    return { ok: false, error: firstError ?? "media send failed" };
  }

  /** POST a message payload to the Graph messages endpoint. */
  private async postMessage(creds: WhatsAppCreds, payload: Record<string, unknown>): Promise<SendResult> {
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        messages?: Array<{ id: string }>;
        error?: { code?: number; message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          error: JSON.stringify(json.error ?? json),
          errorCode: json.error?.code != null ? String(json.error.code) : undefined,
          httpStatus: res.status,
        };
      }
      // Real WhatsApp reports delivered/read via status webhooks, so don't fake it.
      return { ok: true, channelMsgId: json.messages?.[0]?.id, simulated: false };
    } catch (err) {
      // Network/transport error before any HTTP response — transient, worth a retry.
      return { ok: false, error: String(err), retryable: true };
    }
  }

  /** Upload media bytes to Graph, returning the resulting media id (or null). */
  private async uploadMedia(creds: WhatsAppCreds, item: OutboundMedia): Promise<string | null> {
    try {
      const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}/media`;
      // WhatsApp validates the declared MIME against its allow-list (and voice
      // notes must be OGG/OPUS), so send the normalized type rather than the raw
      // recorder container/codec string.
      let mime = whatsappUploadMime(item);
      let bytes = item.bytes;
      const isAudio =
        item.kind === "voice" || item.kind === "audio" || item.mime.toLowerCase().startsWith("audio/");
      if (isAudio) {
        this.logger.log(
          `[voice] in: kind=${item.kind} mime=${item.mime} file=${item.filename} bytes=${item.bytes?.length ?? 0} ` +
            `head=${headHex(item.bytes)} sniff=${audioContainer(item.bytes, item.mime)} intendedMime=${mime}`,
        );
      }
      // A voice note must be Ogg/Opus, but browsers disagree on the recorder
      // container: Chrome/Android emit WebM/Opus, iOS Safari emits MP4/AAC. When
      // we intend audio/ogg but the bytes aren't already an Ogg container,
      // transcode whatever we got to Ogg/Opus (ffmpeg auto-detects the input).
      if (mime === "audio/ogg" && audioContainer(item.bytes, item.mime) !== "ogg") {
        const ogg = await this.transcodeToOggOpus(item.bytes);
        if (ogg) {
          bytes = ogg;
          this.logger.log(`[voice] transcode OK → ogg/opus bytes=${ogg.length} head=${headHex(ogg)}`);
        } else {
          // No transcode (ffmpeg missing) or it failed. NEVER upload non-Ogg
          // bytes labelled audio/ogg — Meta accepts the upload but the clip plays
          // as "audio no longer available". Fall back to the real type if
          // WhatsApp can play it (mp4/aac/mp3 → a plain audio message, not a PTT
          // voice note); WebM is unplayable there, so drop it with a warning
          // rather than deliver a broken clip.
          const base = item.mime.split(";")[0].trim().toLowerCase();
          if (base !== "audio/ogg" && WA_PLAYABLE_AUDIO.has(base)) {
            mime = base;
          } else {
            this.logger.warn(
              `WhatsApp voice: can't transcode ${item.mime} to Ogg/Opus and it isn't a WhatsApp-playable audio type — dropping to avoid a broken clip`,
            );
            return null;
          }
        }
      }
      // Meta keys the container partly off the filename, so an Ogg upload gets a
      // .ogg name; a non-Ogg fallback (mp4/…) keeps its own extension.
      const filename =
        mime === "audio/ogg" && !item.filename.toLowerCase().endsWith(".ogg")
          ? item.filename.replace(/\.[^./\\]+$/, "") + ".ogg"
          : item.filename;
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", mime);
      form.append("file", new Blob([bytes], { type: mime }), filename);
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.accessToken}` },
        body: form,
      });
      const json = (await res.json()) as { id?: string; error?: unknown };
      if (!res.ok || !json.id) {
        this.logger.warn(
          `WhatsApp media upload failed (${res.status}) type=${mime} file=${filename}: ${JSON.stringify(json.error ?? json)}`,
        );
        return null;
      }
      if (isAudio) {
        this.logger.log(
          `[voice] upload OK id=${json.id} sentType=${mime} sentBytes=${bytes.length} head=${headHex(bytes)}`,
        );
      }
      return json.id;
    } catch (err) {
      this.logger.warn(`WhatsApp media upload error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Transcode arbitrary recorded audio — Chrome/Android's WebM/Opus, iOS Safari's
   * MP4/AAC, anything ffmpeg can read — to Ogg/Opus (mono, 48 kHz, 32 kbps: the
   * voice-note sweet spot), so a browser-recorded voice note plays on WhatsApp.
   * ffmpeg auto-detects the input container (the temp input has no extension).
   * Uses temp files under the OS tmpdir and cleans them up. Returns the Ogg bytes,
   * or null if ffmpeg is missing (e.g. a dev box) or the encode fails — the caller
   * must then fall back to the real type or drop the clip; it must NOT upload the
   * un-transcoded bytes as audio/ogg (that plays as "no longer available").
   */
  private async transcodeToOggOpus(input: Buffer): Promise<Buffer | null> {
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), "wa-voice-"));
      const inPath = join(dir, "in.bin"); // no extension → ffmpeg sniffs the container
      const outPath = join(dir, "out.ogg");
      await writeFile(inPath, input);
      await new Promise<void>((resolve, reject) => {
        const ff = spawn(
          "ffmpeg",
          // prettier-ignore
          [
            "-y", "-i", inPath,
            // Take only the first audio stream, drop any video (cover art) and
            // metadata — iOS records MP4/AAC that can carry both, and they confuse
            // the Ogg muxer.
            "-vn", "-map", "0:a:0", "-map_metadata", "-1",
            "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1",
            "-f", "ogg", outPath,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        let stderr = "";
        ff.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        // `error` fires when the binary can't be spawned (ffmpeg not installed).
        ff.on("error", reject);
        ff.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-400)}`));
        });
      });
      const out = await readFile(outPath);
      return out.length > 0 ? out : null;
    } catch (err) {
      this.logger.warn(`WhatsApp voice transcode → Ogg/Opus failed: ${String(err)}`);
      return null;
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** The number's own credentials (Meta-connected inbox) or the global env ones. */
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
}
