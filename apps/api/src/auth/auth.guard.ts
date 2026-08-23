import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { env } from "../config/env";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Global guard. Reads the session JWT from the httpOnly cookie, validates it,
 * and sets `req.userId` (+ `req.sessionId`) for the param decorators. A cookie
 * bound to a session is also checked against revocation, so a remotely
 * signed-out device is rejected on its next request. Public routes (login,
 * health, channel webhooks) are allowed through; everything else needs a session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Guards also wrap WebSocket message handlers — don't gate those here.
    if (ctx.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { userId?: string; sessionId?: string; cookies?: Record<string, string> }>();
    // Browsers send the httpOnly cookie; native clients send the same JWT as a
    // bearer token, because a phone has no cookie jar shared between its HTTP
    // client, its socket and a background push registration.
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const token = req.cookies?.[env.auth.cookieName] ?? bearer;
    const claims = token ? this.auth.verify(token) : undefined;

    if (claims) {
      if (claims.sessionId) {
        // Session-bound cookie: honour revocation (remote sign-out). If revoked,
        // leave req.userId unset so it's treated as unauthenticated below.
        if (await this.sessions.isValid(claims.sessionId)) {
          req.userId = claims.userId;
          req.sessionId = claims.sessionId;
          this.sessions.touch(claims.sessionId);
        }
      } else {
        // Cookie minted before sessions existed — grandfathered through.
        req.userId = claims.userId;
      }
    }

    if (isPublic) return true;
    if (!req.userId) throw new UnauthorizedException("Not authenticated");
    return true;
  }
}
