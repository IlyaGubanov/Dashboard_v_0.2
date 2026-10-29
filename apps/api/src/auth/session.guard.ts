import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthRequest } from '../common/request';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { ALLOW_PASSWORD_CHANGE_PENDING, IS_PUBLIC } from './decorators';

/** Определяет пользователя по cookie сессии. Все маршруты закрыты, кроме помеченных @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const user = token ? await this.auth.resolveSession(token) : null;
    if (!user) throw new UnauthorizedException('Требуется вход в систему');
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, targets)) {
      throw new ForbiddenException({ message: 'Необходимо сменить пароль', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    return true;
  }
}
