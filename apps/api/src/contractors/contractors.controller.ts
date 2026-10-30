import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { contractorCreateSchema, type ContractorCreateData, type ContractorsView } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser } from '../auth/decorators';
import { ContractorsService } from './contractors.service';

/** Подрядчики по всем доступным направлениям. */
@Controller('contractors')
export class ContractorsController {
  constructor(private readonly s: ContractorsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser): Promise<ContractorsView> {
    return this.s.list(u);
  }

  /** Добавить подрядчика в несколько направлений (куратор — в свои, администратор — в любые). */
  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(contractorCreateSchema)) b: ContractorCreateData, @Req() r: AuthRequest) {
    return this.s.create(u, b, clientIp(r));
  }
}
