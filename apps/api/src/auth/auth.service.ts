import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { User } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";

@Injectable()
export class AuthService {
  constructor(private readonly store: Store) {}

  /** Verify email + password against the stored bcrypt hash. */
  async validate(email: string, password: string): Promise<User | null> {
    const user = await this.store.findUserByEmail(email);
    if (!user) return null;
    const hash = await this.store.getPasswordHash(user.id);
    if (!hash) return null;
    return (await bcrypt.compare(password, hash)) ? user : null;
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
