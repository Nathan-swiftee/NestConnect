import { Injectable, Logger } from "@nestjs/common";
import type { AttachmentKind } from "@ding/schemas";
import { env } from "../config/env";
import { Store, type AttachmentInput } from "../data/store";
import { StorageService } from "./storage.service";

interface MediaMeta {
  filename?: string;
  mime?: string;
  kind?: AttachmentKind;
  durationMs?: number;
}

/**
 * Turns provider media into stored attachments. Downloads (WhatsApp media URLs,
 * with the number's bearer token) or accepts already-decoded bytes (Gmail MIME
 * parts), stores them, and returns the AttachmentInput the store persists.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly dataStore: Store,
  ) {}

  /** Load a stored attachment's bytes by id (for outbound delivery). */
  async load(attachmentId: string): Promise<{ bytes: Buffer; mime: string; filename: string } | null> {
    const ref = await this.dataStore.getAttachment(attachmentId);
    if (!ref) return null;
    const bytes = await this.storage.get(ref.storageKey);
    if (!bytes) return null;
    return { bytes, mime: ref.mime, filename: ref.filename };
  }

  /** Download a media URL and store it. Returns null on any failure. */
  async downloadAndStore(
    url: string,
    meta: MediaMeta & { authToken?: string } = {},
  ): Promise<AttachmentInput | null> {
    try {
      const res = await fetch(url, {
        headers: meta.authToken ? { authorization: `Bearer ${meta.authToken}` } : undefined,
      });
      if (!res.ok) {
        this.logger.warn(`Media download failed (${res.status}) for ${url}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > env.media.maxBytes) {
        this.logger.warn(`Media too large (${buf.length} bytes) — skipped`);
        return null;
      }
      const mime = meta.mime || res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
      return this.store(buf, { ...meta, mime });
    } catch (err) {
      this.logger.warn(`Media download error for ${url}: ${String(err)}`);
      return null;
    }
  }

  /** Store already-in-memory bytes (e.g. a decoded Gmail attachment). */
  async store(bytes: Buffer, meta: MediaMeta = {}): Promise<AttachmentInput> {
    const mime = meta.mime || "application/octet-stream";
    const kind = meta.kind ?? kindFromMime(mime);
    const key = this.storage.newKey(extFromMime(mime, meta.filename));
    await this.storage.put(key, bytes, mime);
    return {
      storageKey: key,
      kind,
      mime,
      size: bytes.length,
      filename: meta.filename || defaultName(kind, mime),
      durationMs: meta.durationMs,
    };
  }
}

/** Map a MIME type to our coarse attachment kind. */
export function kindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return mime === "image/webp" ? "sticker" : "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Best-effort file extension from a MIME type (or an existing filename). */
export function extFromMime(mime: string, filename?: string): string {
  const fromName = filename?.includes(".") ? filename.split(".").pop() : undefined;
  if (fromName) return fromName;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

function defaultName(kind: AttachmentKind, mime: string): string {
  const ext = extFromMime(mime);
  const label: Record<AttachmentKind, string> = {
    image: "photo",
    video: "video",
    audio: "audio",
    voice: "voice-message",
    document: "document",
    sticker: "sticker",
    file: "file",
  };
  return `${label[kind]}.${ext}`;
}
