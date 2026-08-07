import { Injectable, Logger } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { R2Driver } from "./r2.driver";

/**
 * Object storage for message media. Uses Cloudflare R2 when configured (all four
 * R2_* env vars set), otherwise a local-disk driver (works in dev and on
 * Railway, though Railway disk is ephemeral). Keys are app-generated
 * (`YYYY/MM/uuid.ext`) so they're safe to join onto a base path or R2 prefix.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly base = env.media.dir;
  private readonly r2: R2Driver | null;

  constructor() {
    const { accountId, accessKeyId, secretAccessKey, bucket } = env.r2;
    this.r2 = accountId && accessKeyId && secretAccessKey && bucket ? new R2Driver() : null;
    this.logger.log(`Media storage: ${this.r2 ? `Cloudflare R2 (${bucket})` : `local disk (${this.base})`}`);
  }

  /** A fresh, collision-free storage key with an optional extension. */
  newKey(ext?: string): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const clean = (ext ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
    return `${yyyy}/${mm}/${randomUUID()}${clean ? `.${clean}` : ""}`;
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    if (this.r2) {
      await this.r2.put(key, body, contentType);
      return;
    }
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer | null> {
    if (this.r2) {
      try {
        return await this.r2.get(key);
      } catch (err) {
        this.logger.warn(`R2 read failed for ${key}: ${String(err)}`);
        return null;
      }
    }
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
