import { Body, Controller, Get, Post, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { loginInputSchema, type LoginInput } from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Store } from "../data/store";
import { env } from "../config/env";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { CurrentUserId } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly store: Store,
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
}
