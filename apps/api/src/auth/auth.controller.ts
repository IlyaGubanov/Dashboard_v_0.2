import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput, type Me } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { AllowPasswordChangePending, CurrentUser, Public } from './decorators';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  // не более 10 попыток входа в минуту с одного адреса
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const { token, expiresAt } = await this.auth.login(body.login, body.password, clientIp(req), req.get('user-agent') ?? null);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, expires: expiresAt });
    return { ok: true };
  }

  @AllowPasswordChangePending()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, clientIp(req));
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    return { ok: true };
  }

  @AllowPasswordChangePending()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.auth.me(user.id);
  }

  @AllowPasswordChangePending()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: AuthRequest,
  ) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, clientIp(req));
    return { ok: true };
  }
}
