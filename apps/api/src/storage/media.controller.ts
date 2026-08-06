import { Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Store } from "../data/store";
import { StorageService } from "./storage.service";

/**
 * Streams a stored attachment by id. Authenticated (the global guard applies) —
 * same-origin `<img src>` / `<audio src>` / download links send the session
 * cookie, so this Just Works from the thread. `?dl=1` forces a download.
 */
@Controller("media")
export class MediaController {
  constructor(
    private readonly store: Store,
    private readonly storage: StorageService,
  ) {}

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
