import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { departmentSchema, type DepartmentData, type DepartmentItem } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser, Roles } from '../auth/decorators';
import { UsersService } from './users.service';

const departmentPatchSchema = departmentSchema.partial();

/** Справочник подразделений — ведёт администратор. Удаление = архив. */
@Roles('ADMIN')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<DepartmentItem[]> {
    return this.users.departments();
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(departmentSchema)) body: DepartmentData, @Req() req: AuthRequest) {
    return this.users.createDepartment(actor, body, clientIp(req));
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(departmentPatchSchema)) body: Partial<DepartmentData>,
    @Req() req: AuthRequest,
  ) {
    return this.users.updateDepartment(actor, id, body, clientIp(req));
  }
}
