import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { env } from "../config/env";
import { AuthService } from "./auth.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Global guard. Reads the session JWT from the httpOnly cookie, validates it,
 * and sets `req.userId` for `@CurrentUserId()`. Public routes (login, health,
 * channel webhooks) are allowed through; everything else requires a session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Guards also wrap WebSocket message handlers — don't gate those here.
    if (ctx.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request & { userId?: string; cookies?: Record<string, string> }>();
    const token = req.cookies?.[env.auth.cookieName];
    const userId = token ? this.auth.verify(token) : undefined;
    if (userId) req.userId = userId;

    if (isPublic) return true;
    if (!userId) throw new UnauthorizedException("Not authenticated");
    return true;
  }
}
