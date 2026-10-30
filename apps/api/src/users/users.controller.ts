import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  membershipSchema,
  resetPasswordSchema,
  userCreateSchema,
  userImportSchema,
  userUpdateSchema,
  type MembershipData,
  type UserCreateData,
  type UserUpdateData,
} from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser, Roles } from '../auth/decorators';
import { UsersService } from './users.service';
import { UsersImportService } from './users-import.service';

const resetSchema = resetPasswordSchema.extend({ login: z.string().trim().min(3).max(64).optional() });

/** Управление пользователями и их ролями в направлениях — только администратор. */
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly importer: UsersImportService,
  ) {}

  /** Загрузка списком: dryRun = true — только проверка. */
  @Post('import')
  @HttpCode(200)
  import(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(userImportSchema)) body: z.output<typeof userImportSchema>, @Req() req: AuthRequest) {
    return this.importer.run(actor, body.rows, body.dryRun, clientIp(req));
  }

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(userCreateSchema)) body: UserCreateData,
    @Req() req: AuthRequest,
  ) {
    return this.users.create(actor, body, clientIp(req));
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(userUpdateSchema)) body: UserUpdateData,
    @Req() req: AuthRequest,
  ) {
    return this.users.update(actor, id, body, clientIp(req));
  }

  @Post(':id/password')
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(resetSchema)) body: z.output<typeof resetSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.users.resetPassword(actor, id, body.password, body.login, clientIp(req));
  }

  @Put(':id/memberships')
  setMemberships(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(z.array(membershipSchema))) body: MembershipData[],
    @Req() req: AuthRequest,
  ) {
    return this.users.setMemberships(actor, id, body, clientIp(req));
  }

  @Post(':id/unlock')
  unlock(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Req() req: AuthRequest) {
    return this.users.unlock(actor, id, clientIp(req));
  }
}
