import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import type { Attachment, AttachmentKind } from "@ding/schemas";
import { attachmentKindSchema } from "@ding/schemas";
import { env } from "../config/env";
import { ORG_ID } from "../data/fixtures";
import { Store } from "../data/store";
import { CurrentUserId } from "../auth/current-user.decorator";
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
    // What the file is called, when the part's own filename isn't it. The phone
    // uploads natively from a cache path, so the multipart filename is whatever
    // the picker happened to write to disk — "DOC_20260827.tmp" rather than
    // "Purchase-Order-4471.pdf". Sanitised the same way either way.
    @Body("filename") filename?: string,
  ): Promise<Attachment> {
    if (!file?.buffer?.length) throw new BadRequestException("No file uploaded");
    if (file.size > env.media.maxBytes) throw new BadRequestException("File too large");

    const parsedKind = attachmentKindSchema.safeParse(kind);
    const input = await this.media.store(file.buffer, {
      mime: file.mimetype,
      filename: sanitizeName(filename?.trim() || file.originalname),
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
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query("dl") dl?: string,
  ): Promise<void> {
    const access = await this.store.getAttachmentAccess(id);
    if (!access) throw new NotFoundException("Attachment not found");

    // IDOR guard: media attached to a conversation is only readable within its
    // owning org. (Staged uploads have no conversation yet — any authenticated
    // user may fetch their own upload for the composer preview.)
    if (access.orgId) {
      const me = await this.store.getUser(userId);
      if (!me || me.orgId !== access.orgId) {
        throw new ForbiddenException("Not authorized for this media");
      }
    }

    const downloadName = dl ? access.filename : undefined;

    // R2: hand the client a short-lived presigned URL and redirect. The bytes
    // stream straight from R2 (Range + CDN), never through this process — so a
    // 100MB object is never loaded into Node memory, and the URL expires.
    const presigned = await this.storage.presignedGetUrl(access.storageKey, {
      expiresSeconds: 900, // 15 min — long enough to seek a video, short enough to stay private
      downloadName,
    });
    if (presigned) {
      res.redirect(302, presigned);
      return;
    }

    // Local disk (dev): stream with proper Range support, never buffering whole.
    const stat = await this.storage.diskStat(access.storageKey);
    if (!stat) throw new NotFoundException("File not found");
    res.set("Content-Type", access.mime || "application/octet-stream");
    res.set("Accept-Ranges", "bytes");
    res.set("Cache-Control", "private, max-age=86400");
    if (downloadName) {
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
    }

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m?.[1] ? parseInt(m[1], 10) : 0;
      let end = m?.[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) {
        res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
        return;
      }
      res.status(206);
      res.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.set("Content-Length", String(end - start + 1));
      this.storage.diskReadStream(access.storageKey, start, end).pipe(res);
    } else {
      res.set("Content-Length", String(stat.size));
      this.storage.diskReadStream(access.storageKey).pipe(res);
    }
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
