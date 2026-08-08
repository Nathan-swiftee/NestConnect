import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { User } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";

/** Failed logins allowed per account before a cooldown kicks in, and the window. */
const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(private readonly store: Store) {}

  // Per-account failed-attempt tracking to slow credential brute-forcing.
  // In-memory (per node) — good enough at this scale; a shared store would be
  // the multi-node upgrade.
  private readonly failures = new Map<string, { count: number; first: number }>();

  private key(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Throw 429 if this account has too many recent failures. Call before validate. */
  assertNotThrottled(email: string): void {
    const rec = this.failures.get(this.key(email));
    if (!rec) return;
    if (Date.now() - rec.first > WINDOW_MS) {
      this.failures.delete(this.key(email));
      return;
    }
    if (rec.count >= MAX_FAILURES) {
      throw new HttpException("Too many login attempts — try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(email: string): void {
    const k = this.key(email);
    const rec = this.failures.get(k);
    if (!rec || Date.now() - rec.first > WINDOW_MS) {
      this.failures.set(k, { count: 1, first: Date.now() });
    } else {
      rec.count += 1;
    }
  }

  /** Verify email + password against the stored bcrypt hash. */
  async validate(email: string, password: string): Promise<User | null> {
    const user = await this.store.findUserByEmail(email);
    if (!user) {
      this.recordFailure(email);
      return null;
    }
    const hash = await this.store.getPasswordHash(user.id);
    if (!hash || !(await bcrypt.compare(password, hash))) {
      this.recordFailure(email);
      return null;
    }
    this.failures.delete(this.key(email));
    return user;
  }

  sign(userId: string): string {
    return jwt.sign({ sub: userId }, env.auth.jwtSecret, { expiresIn: env.auth.ttlSeconds });
  }

  verify(token: string): string | undefined {
    try {
      const payload = jwt.verify(token, env.auth.jwtSecret) as { sub?: string };
      return payload.sub;
    } catch {
      return undefined;
    }
  }
}
