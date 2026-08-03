import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { DEMO_USER_ID } from "../data/fixtures";

/**
 * Resolves the current user for the request. Phase 0/1 uses a demo identity
 * (overridable via the `x-ding-user` header for testing). Real auth — a JWT /
 * WorkOS session verified here — slots straight into this middleware without
 * touching controllers, which read the id via `@CurrentUserId()`.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.header("x-ding-user");
    (req as Request & { userId?: string }).userId = header || DEMO_USER_ID;
    next();
  }
}
