import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  changePasswordInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  setPasswordInputSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type SetPasswordInput,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Store } from "../data/store";
import { env } from "../config/env";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { Mailer } from "../mail/mailer.service";
import { Public } from "./public.decorator";
import { CurrentUserId, CurrentSessionId } from "./current-user.decorator";

/** Session cookie options — shared by login and set-password. */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.isProd,
    maxAge: env.auth.ttlSeconds * 1000,
    path: "/",
  };
}

/** Client IP (first X-Forwarded-For hop behind Railway's proxy) + User-Agent. */
function clientMeta(req: Request): { ip?: string; userAgent?: string } {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const ip = xff || req.ip || req.socket?.remoteAddress || undefined;
  const userAgent = (req.headers["user-agent"] as string | undefined) || undefined;
  return { ip, userAgent };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly store: Store,
    private readonly mailer: Mailer,
  ) {}

  @Public()
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.auth.assertNotThrottled(body.email);
    const user = await this.auth.validate(body.email, body.password);
    if (!user) throw new UnauthorizedException("Invalid email or password");

    const sessionId = await this.sessions.create(user.id, clientMeta(req));
    res.cookie(env.auth.cookieName, this.auth.sign(user.id, sessionId), cookieOptions());
    return this.store.me(user.id);
  }

  /** Set an initial password from an emailed invite link, then sign in. */
  @Public()
  @Post("set-password")
  async setPassword(
    @Body(new ZodValidationPipe(setPasswordInputSchema)) body: SetPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.store.setPasswordByInviteToken(body.token, body.password);
    if (!user) throw new UnauthorizedException("This invite link is invalid or has expired.");
    const sessionId = await this.sessions.create(user.id, clientMeta(req));
    res.cookie(env.auth.cookieName, this.auth.sign(user.id, sessionId), cookieOptions());
    return this.store.me(user.id);
  }

  /**
   * Request a password-reset link. Always responds `{ ok: true }` — we never
   * reveal whether an address has an account. When it matches a user and a
   * transactional sender is configured, a reset link is emailed.
   */
  @Public()
  @Post("forgot-password")
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordInputSchema)) body: ForgotPasswordInput,
  ) {
    const reset = await this.store.createPasswordResetToken(body.email);
    if (reset) {
      const url = `${env.appUrl}/?reset=${reset.token}`;
      await this.mailer.sendPasswordReset(reset.user.email, reset.user.name, url);
    }
    return { ok: true };
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Revoke the current session so the cookie can't be replayed after sign-out.
    const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[env.auth.cookieName];
    const claims = token ? this.auth.verify(token) : undefined;
    if (claims?.sessionId) await this.sessions.revoke(claims.userId, claims.sessionId).catch(() => {});
    res.clearCookie(env.auth.cookieName, { path: "/" });
    return { ok: true };
  }

  @Get("session")
  session(@CurrentUserId() userId: string) {
    return this.store.me(userId);
  }

  /** Change your own password — the current one is re-verified server-side. */
  @Post("change-password")
  async changePassword(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(changePasswordInputSchema)) body: ChangePasswordInput,
  ) {
    const ok = await this.auth.changePassword(userId, body.currentPassword, body.newPassword);
    if (!ok) throw new BadRequestException("Your current password is incorrect.");
    return { ok: true };
  }

  /* ---- signed-in sessions ("where you're logged in") ---- */

  @Get("sessions")
  listSessions(@CurrentUserId() userId: string, @CurrentSessionId() currentId?: string) {
    return this.sessions.list(userId, currentId);
  }

  /** Sign out every other device; the current session is kept. */
  @Post("sessions/revoke-others")
  async revokeOtherSessions(@CurrentUserId() userId: string, @CurrentSessionId() currentId?: string) {
    const revoked = await this.sessions.revokeOthers(userId, currentId ?? "");
    return { revoked };
  }

  @Delete("sessions/:id")
  async revokeSession(@CurrentUserId() userId: string, @Param("id") id: string) {
    const ok = await this.sessions.revoke(userId, id);
    if (!ok) throw new NotFoundException("Session not found");
    return { ok: true };
  }
}
