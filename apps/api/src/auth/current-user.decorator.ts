import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { DEMO_USER_ID } from "../data/fixtures";

/** Injects the current user's id (set by AuthMiddleware) into a handler param. */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
  return req.userId ?? DEMO_USER_ID;
});
