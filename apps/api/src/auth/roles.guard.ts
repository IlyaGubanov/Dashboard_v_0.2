import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GlobalRole } from '@prisma/client';
import type { AuthRequest } from '../common/request';
import { ROLES } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<GlobalRole[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
    if (user && roles.includes(user.globalRole)) return true;
    throw new ForbiddenException('Недостаточно прав');
  }
}
