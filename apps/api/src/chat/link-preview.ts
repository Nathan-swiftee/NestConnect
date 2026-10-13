import { Injectable, Logger } from "@nestjs/common";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { ChatLinkPreview } from "@ding/schemas";

/** The first web link in a message, as written. */
export function firstLink(body: string): string | null {
  const m = /\bhttps?:\/\/[^\s<>"']+/i.exec(body);
  if (!m) return null;
  // "see https://x.com/a." — the full stop ends the sentence, not the link.
  return m[0].replace(/[.,;:!?)\]]+$/, "");
}

const TIMEOUT_MS = 4_000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Is this address somewhere a server on the internet may be asked to fetch from?
 * Loopback, private ranges, link-local (cloud metadata lives there), CGNAT,
 * multicast and their IPv6 counterparts are not.
 */
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]!);
    // The same, written in hex — or NAT64 — could be anything inside: refuse rather than decode.
    if (v.startsWith("::ffff:") || v.startsWith("64:ff9b:")) return false;
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v)) return false;
    return true;
  }
  return false;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return ENTITIES[k] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a page says about itself, from its Open Graph tags, or its <title>. */
export function parsePreview(html: string, url: string): ChatLinkPreview | null {
  const head = html.slice(0, MAX_BYTES);
  const meta = (names: string[]): string | null => {
    for (const name of names) {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
      const tag = re.exec(head)?.[0];
      const content = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
      if (content?.trim()) return decode(content);
    }
    return null;
  };
  const title = meta(["og:title", "twitter:title"]) ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(head)![1]!) : null);
  if (!title) return null;
  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = null;
  }
  const description = meta(["og:description", "twitter:description", "description"]);
  return {
    url,
    title: clip(title, 200),
    description: description ? clip(description, 300) : null,
    siteName: meta(["og:site_name"]) ?? host,
  };
}

/**
 * Fetches a link's title and description for the card under a chat message.
 *
 * The server fetching a URL someone typed is the classic way into a private
 * network, so: http(s) on the standard ports only; every hostname resolved and
 * every address checked public before connecting — and the connection made to
 * that checked address, so a second DNS answer can't swap it for an internal
 * one; redirects followed by hand and checked again; HTML only; a few seconds
 * and a few hundred KB at most. Anything else is simply no preview.
 */
@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger(LinkPreviewService.name);

  /** Only for the checks, which serve their pages from localhost. */
  allowPrivate = false;

  async preview(url: string): Promise<ChatLinkPreview | null> {
    try {
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await this.get(current);
        if (res.redirect) {
          current = new URL(res.redirect, current).toString();
          continue;
        }
        return res.html ? parsePreview(res.html, url) : null;
      }
      return null;
    } catch (err) {
      this.logger.debug(`No preview for ${url}: ${String(err)}`);
      return null;
    }
  }

  private get(raw: string): Promise<{ html?: string; redirect?: string }> {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not http(s)");
    if (url.port && !["80", "443"].includes(url.port) && !this.allowPrivate) throw new Error("non-standard port");
    if (url.username || url.password) throw new Error("credentials in URL");

    const allowPrivate = !!this.allowPrivate;
    // Resolve, check, and hand the socket that exact address.
    const lookup: LookupFunction = (hostname, options, cb) => {
      dnsLookup(hostname, { all: true })
        .then((addrs) => {
          const ok = addrs.find((a) => allowPrivate || isPublicAddress(a.address));
          if (!ok || (!allowPrivate && addrs.some((a) => !isPublicAddress(a.address)))) {
            cb(new Error(`refusing ${hostname}: not a public address`), "", 4);
            return;
          }
          if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: typeof addrs) => void)(null, [ok]);
          else cb(null, ok.address, ok.family);
        })
        .catch((e: Error) => cb(e as NodeJS.ErrnoException, "", 4));
    };
    if (isIP(url.hostname) && !allowPrivate && !isPublicAddress(url.hostname)) throw new Error("private address");

    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          lookup,
          timeout: TIMEOUT_MS,
          headers: { "user-agent": "NestConnectLinkPreview/1.0 (+https://nestconnect.app)", accept: "text/html" },
        },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            resolve({ redirect: res.headers.location });
            return;
          }
          const type = String(res.headers["content-type"] ?? "");
          if (status !== 200 || !type.includes("text/html")) {
            res.resume();
            resolve({});
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BYTES) {
              res.destroy();
              resolve({ html: Buffer.concat(chunks).toString("utf8") });
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", reject);
      req.end();
    });
  }
}
