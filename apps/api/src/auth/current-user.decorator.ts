import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/**
 * Injects the current user's id (set by AuthGuard from the verified session).
 * Throws rather than falling back to a default identity, so a route that reaches
 * this without a session fails closed instead of silently running as someone.
 */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
  if (!req.userId) throw new UnauthorizedException("Not authenticated");
  return req.userId;
});
