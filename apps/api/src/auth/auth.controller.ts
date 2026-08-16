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
  twoFactorCodeInputSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type SetPasswordInput,
  type TwoFactorCodeInput,
  type User,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Store } from "../data/store";
import { env } from "../config/env";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { TwoFactorService } from "./two-factor.service";
import { Mailer } from "../mail/mailer.service";
import { Public } from "./public.decorator";
import { CurrentUserId, CurrentSessionId } from "./current-user.decorator";

/** Cookie carrying the half-authenticated "2FA pending" token (password OK,
 *  awaiting a code). Distinct from the real session cookie. */
const PENDING_COOKIE = `${env.auth.cookieName}_2fa`;

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

function readCookie(req: Request, name: string): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly store: Store,
    private readonly mailer: Mailer,
  ) {}

  /** Start a real session for a fully-authenticated user and set the cookie. */
  private async grantSession(userId: string, req: Request, res: Response) {
    const sessionId = await this.sessions.create(userId, clientMeta(req));
    res.cookie(env.auth.cookieName, this.auth.sign(userId, sessionId), cookieOptions());
    return this.store.me(userId);
  }

  private async requireUser(userId: string): Promise<User> {
    const me = await this.store.me(userId);
    if (!me.user) throw new UnauthorizedException("Not authenticated");
    return me.user;
  }

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

    // 2FA on → stop at a half-authenticated state; the client posts the code next.
    if (user.twoFactorEnabled) {
      res.cookie(PENDING_COOKIE, this.auth.signPending(user.id), { ...cookieOptions(), maxAge: 5 * 60 * 1000 });
      if (user.twoFactorMethod === "email") await this.twoFactor.sendEmailCode(user);
      return { twoFactorRequired: true as const, method: user.twoFactorMethod ?? "totp" };
    }
    return this.grantSession(user.id, req, res);
  }

  /** Second login step: verify the 2FA code (or a recovery code) → real session. */
  @Public()
  @Post("login/2fa")
  async loginTwoFactor(
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: TwoFactorCodeInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = this.auth.verifyPending(readCookie(req, PENDING_COOKIE) ?? "");
    if (!userId) throw new UnauthorizedException("Your sign-in expired — please start again.");
    if (!(await this.twoFactor.verifyChallenge(userId, body.code))) {
      throw new UnauthorizedException("That code isn't right.");
    }
    res.clearCookie(PENDING_COOKIE, { path: "/" });
    return this.grantSession(userId, req, res);
  }

  /** Email-method only: resend the code during the login challenge. */
  @Public()
  @Post("login/2fa/resend")
  async resendLoginCode(@Req() req: Request) {
    const userId = this.auth.verifyPending(readCookie(req, PENDING_COOKIE) ?? "");
    if (!userId) throw new UnauthorizedException("Your sign-in expired — please start again.");
    const user = await this.requireUser(userId);
    if (user.twoFactorMethod === "email") await this.twoFactor.sendEmailCode(user);
    return { ok: true };
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
    return this.grantSession(user.id, req, res);
  }

  /**
   * Request a password-reset link. Always responds `{ ok: true }` — we never
   * reveal whether an address has an account.
   */
  @Public()
  @Post("forgot-password")
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordInputSchema)) body: ForgotPasswordInput) {
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
    const claims = this.auth.verify(readCookie(req, env.auth.cookieName) ?? "");
    if (claims?.sessionId) await this.sessions.revoke(claims.userId, claims.sessionId).catch(() => {});
    res.clearCookie(env.auth.cookieName, { path: "/" });
    res.clearCookie(PENDING_COOKIE, { path: "/" });
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

  /* ---- two-factor auth ---- */

  @Get("2fa/status")
  twoFactorStatus(@CurrentUserId() userId: string) {
    return this.twoFactor.status(userId);
  }

  /** Begin authenticator setup → QR + manual key (not enabled until confirmed). */
  @Post("2fa/totp/start")
  async startTotp(@CurrentUserId() userId: string) {
    return this.twoFactor.startTotpSetup(await this.requireUser(userId));
  }

  @Post("2fa/totp/enable")
  async enableTotp(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: TwoFactorCodeInput,
  ) {
    const recoveryCodes = await this.twoFactor.enableTotp(userId, body.code);
    if (!recoveryCodes) throw new BadRequestException("That code isn't right — try the current one from your app.");
    return { recoveryCodes };
  }

  /** Email a code to start (or re-start) email-method setup. */
  @Post("2fa/email/start")
  async startEmail(@CurrentUserId() userId: string) {
    await this.twoFactor.sendEmailCode(await this.requireUser(userId));
    return { ok: true };
  }

  @Post("2fa/email/enable")
  async enableEmail(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: TwoFactorCodeInput,
  ) {
    const recoveryCodes = await this.twoFactor.enableEmail(userId, body.code);
    if (!recoveryCodes) throw new BadRequestException("That code isn't right or has expired.");
    return { recoveryCodes };
  }

  @Post("2fa/recovery/regenerate")
  async regenerateRecovery(@CurrentUserId() userId: string) {
    return { recoveryCodes: await this.twoFactor.regenerateRecoveryCodes(userId) };
  }

  @Post("2fa/disable")
  async disableTwoFactor(@CurrentUserId() userId: string) {
    await this.twoFactor.disable(userId);
    return { ok: true };
  }
}
