import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";

// A 1×1 fully-transparent GIF — the smallest valid image to hand back to the
// email client whether or not the token resolves.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/**
 * Public email open-tracking pixel.
 *
 * `GET /track/open/:token(.gif)` — an email client requesting this URL (when it
 * loads images) records that THIS recipient, identified by the unguessable
 * token, opened the email. Powers the per-recipient "Seen" indicators.
 *
 * Unauthenticated by design (a recipient has no app session). It always returns
 * the pixel — for a valid, unknown, or already-seen token alike — so it never
 * reveals whether a token exists, and a scanner probing random tokens learns
 * nothing. Only a genuine token stamps an open.
 */
@Controller("track")
export class TrackingController {
  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Public()
  @Get("open/:token")
  async open(@Param("token") token: string, @Res() res: Response): Promise<void> {
    // The URL carries a `.gif` (or `.png`) suffix for email-client friendliness.
    const clean = token.replace(/\.(gif|png|jpg)$/i, "");
    try {
      const change = await this.store.recordEmailOpen(clean);
      // Broadcast the "Seen" so open threads update live (first open only).
      if (change) this.realtime.emitMessageUpdated(change.conversationId, change.message);
    } catch {
      // A tracking hiccup must never break the pixel response.
    }
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Content-Length", String(PIXEL.length));
    res.end(PIXEL);
  }
}
