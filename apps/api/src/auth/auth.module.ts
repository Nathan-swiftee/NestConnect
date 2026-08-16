import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
