import { Controller, Get, Logger, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";

// A 1×1 fully-transparent GIF — the smallest valid image to hand back to the
// email client whether or not the token resolves.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

// Fetchers that are never a human reading an email: scripts, crawlers, link
// unfurlers, and mail-security scanners. We skip recording an open for these.
// NB: image proxies that DO carry genuine opens — Gmail's GoogleImageProxy,
// Yahoo, Apple Mail — are deliberately NOT here; the send-time grace window in
// the store handles their pre-cache instead of dropping their real opens.
const BOT_UA = [
  "curl", "wget", "python", "go-http-client", "java/", "node-fetch", "axios",
  "okhttp", "headlesschrome", "phantomjs", "googlebot", "bingbot", "yandex",
  "facebookexternalhit", "slackbot", "twitterbot", "discordbot", "telegrambot",
  "linkedinbot", "whatsapp", "bot/", "spider", "crawler", "monitor", "uptime",
  "barracuda", "mimecast", "proofpoint", "symantec", "ironport", "microsoft-atp",
];

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
 * nothing. Only a genuine token, fetched by something that looks like a real
 * reader and outside the just-sent grace window, stamps an open.
 */
@Controller("track")
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Public()
  @Get("open/:token")
  async open(@Param("token") token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    // The URL carries a `.gif` (or `.png`) suffix for email-client friendliness.
    const clean = token.replace(/\.(gif|png|jpg)$/i, "");
    const ua = (req.headers["user-agent"] ?? "").toString();
    if (!isBotFetcher(ua)) {
      try {
        // The store also suppresses opens inside the send-time grace window.
        const change = await this.store.recordEmailOpen(clean);
        if (change) {
          this.realtime.emitMessageUpdated(change.conversationId, change.message);
          this.logger.debug(`Open recorded (${clean.slice(0, 8)}…) ua="${ua.slice(0, 80)}"`);
        }
      } catch {
        // A tracking hiccup must never break the pixel response.
      }
    }
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Content-Length", String(PIXEL.length));
    res.end(PIXEL);
  }
}

/** True for user-agents that are never a human opening an email (scripts,
 *  crawlers, link unfurlers, security scanners). */
function isBotFetcher(ua: string): boolean {
  const s = ua.toLowerCase();
  if (!s) return true; // no UA at all → almost always a script/scanner
  return BOT_UA.some((b) => s.includes(b));
}
