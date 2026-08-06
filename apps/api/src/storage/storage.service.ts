import { Injectable, Logger } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";

/**
 * Object storage for message media. Today this is a local-disk driver (works in
 * dev and on Railway, though Railway disk is ephemeral); a Cloudflare R2 / S3
 * driver drops in behind the same interface for production durability. Keys are
 * app-generated (`YYYY/MM/uuid.ext`) so they're safe to join onto a base path.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly base = env.media.dir;

  /** A fresh, collision-free storage key with an optional extension. */
  newKey(ext?: string): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const clean = (ext ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
    return `${yyyy}/${mm}/${randomUUID()}${clean ? `.${clean}` : ""}`;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer | null> {
    const path = this.resolve(key);
    if (!existsSync(path)) return null;
    try {
      return await readFile(path);
    } catch (err) {
      this.logger.warn(`Failed to read media ${key}: ${String(err)}`);
      return null;
    }
  }

  /** Resolve a key under the base dir, refusing any path-traversal escape. */
  private resolve(key: string): string {
    const path = normalize(join(this.base, key));
    const root = normalize(this.base).replace(/[/\\]+$/, "");
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error("Invalid storage key");
    }
    return path;
  }
}
