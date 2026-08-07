import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { Attachment, AttachmentKind } from "@ding/schemas";
import { attachmentKindSchema } from "@ding/schemas";
import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import { Store } from "../data/store";
import { MediaService } from "./media.service";
import { StorageService } from "./storage.service";

/** The subset of a multer file we rely on (avoids an Express.Multer.File dep). */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Serves stored attachments and accepts composer uploads.
 *
 * `GET /media/:id` streams a stored file. Authenticated (the global guard
 * applies) — same-origin `<img src>` / `<audio src>` / download links send the
 * session cookie, so this Just Works from the thread. `?dl=1` forces a download.
 *
 * `POST /media` stages an uploaded file (multipart) as an attachment not yet
 * tied to a message; the returned id is referenced on send.
 */
@Controller("media")
export class MediaController {
  constructor(
    private readonly store: Store,
    private readonly storage: StorageService,
    private readonly media: MediaService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body("kind") kind?: string,
    @Body("durationMs") durationMs?: string,
    @Body("width") width?: string,
    @Body("height") height?: string,
    @Body("waveform") waveform?: string,
  ): Promise<Attachment> {
    if (!file?.buffer?.length) throw new BadRequestException("No file uploaded");
    if (file.size > env.media.maxBytes) throw new BadRequestException("File too large");

    const parsedKind = attachmentKindSchema.safeParse(kind);
    const input = await this.media.store(file.buffer, {
      mime: file.mimetype,
      filename: sanitizeName(file.originalname),
      kind: parsedKind.success ? (parsedKind.data as AttachmentKind) : undefined,
      durationMs: toInt(durationMs),
    });
    input.width = toInt(width);
    input.height = toInt(height);
    input.waveform = parseWaveform(waveform);
    return this.store.createUploadAttachment(ORG_ID, input);
  }

  @Get(":id")
  async serve(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("dl") dl?: string,
  ): Promise<void> {
    const ref = await this.store.getAttachment(id);
    if (!ref) throw new NotFoundException("Attachment not found");
    const bytes = await this.storage.get(ref.storageKey);
    if (!bytes) throw new NotFoundException("File not found");

    res.set("Content-Type", ref.mime || "application/octet-stream");
    res.set("Content-Length", String(bytes.length));
    res.set("Cache-Control", "private, max-age=86400");
    res.set("Accept-Ranges", "bytes");
    if (dl) {
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(ref.filename)}"`);
    }
    res.send(bytes);
  }
}

/** Parse a non-negative integer form field, or undefined. */
function toInt(value?: string): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** Strip any path components from an upload's filename (defence in depth). */
function sanitizeName(name?: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  return base.trim().slice(0, 200) || "file";
}

/** Parse a JSON array of waveform peaks (numbers), clamped to a sane length. */
function parseWaveform(raw?: string): number[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const nums = parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    return nums.length ? nums.slice(0, 256) : undefined;
  } catch {
    return undefined;
  }
}
