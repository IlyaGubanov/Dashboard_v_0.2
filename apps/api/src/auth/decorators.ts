import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { GlobalRole } from '@prisma/client';
import type { AuthRequest, AuthUser } from '../common/request';

export const IS_PUBLIC = 'isPublic';
/** Маршрут доступен без входа. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Маршрут доступен только указанным глобальным ролям. */
export const Roles = (...roles: GlobalRole[]) => SetMetadata(ROLES, roles);

export const ALLOW_PASSWORD_CHANGE_PENDING = 'allowPwdPending';
/** Маршрут доступен, даже если пользователь обязан сменить пароль. */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<AuthRequest>().user!,
);
