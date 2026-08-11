import { BadRequestException, Body, Controller, Get, Post, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
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
import { Mailer } from "../mail/mailer.service";
import { Public } from "./public.decorator";
import { CurrentUserId } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly store: Store,
    private readonly mailer: Mailer,
  ) {}

  @Public()
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.auth.assertNotThrottled(body.email);
    const user = await this.auth.validate(body.email, body.password);
    if (!user) throw new UnauthorizedException("Invalid email or password");

    res.cookie(env.auth.cookieName, this.auth.sign(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProd,
      maxAge: env.auth.ttlSeconds * 1000,
      path: "/",
    });
    return this.store.me(user.id);
  }

  /** Set an initial password from an emailed invite link, then sign in. */
  @Public()
  @Post("set-password")
  async setPassword(
    @Body(new ZodValidationPipe(setPasswordInputSchema)) body: SetPasswordInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.store.setPasswordByInviteToken(body.token, body.password);
    if (!user) throw new UnauthorizedException("This invite link is invalid or has expired.");
    res.cookie(env.auth.cookieName, this.auth.sign(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProd,
      maxAge: env.auth.ttlSeconds * 1000,
      path: "/",
    });
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
  logout(@Res({ passthrough: true }) res: Response) {
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
}
