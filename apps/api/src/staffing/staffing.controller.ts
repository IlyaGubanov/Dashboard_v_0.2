import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req } from '@nestjs/common';
import { staffingEditorsSchema, staffingMovementSaveSchema, staffingPayrollSaveSchema, staffingPayrollSchema, staffingPeriodSaveSchema, staffingPeriodSchema, type StaffingMovementDayData, type StaffingPayrollData, type StaffingPeriodData } from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import { AccessService } from '../auth/access.service';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { StaffingService } from './staffing.service';

@Controller('staffing')
export class StaffingController {
  constructor(private readonly s: StaffingService, private readonly access: AccessService) {}
  @Get('access') permissions(@CurrentUser() u: AuthUser) { return this.access.staffingPermissions(u); }
  @Get() view(@CurrentUser() u: AuthUser) { return this.s.view(u); }
  @Post('periods') create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(staffingPeriodSchema)) b: StaffingPeriodData, @Req() r: AuthRequest) { return this.s.create(u, b, clientIp(r)); }
  @Put('periods/:month') save(@CurrentUser() u: AuthUser, @Param('month') month: string, @Body(new ZodPipe(staffingPeriodSaveSchema)) b: { version: number; data: StaffingPeriodData; isArchived?: boolean }, @Req() r: AuthRequest) { return this.s.save(u, month, b, clientIp(r)); }
  @Post('payroll') createPayroll(@CurrentUser() u: AuthUser, @Body(new ZodPipe(staffingPayrollSchema)) b: StaffingPayrollData, @Req() r: AuthRequest) { return this.s.createPayroll(u, b, clientIp(r)); }
  @Put('payroll/:year') savePayroll(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number, @Body(new ZodPipe(staffingPayrollSaveSchema)) b: { version: number; data: StaffingPayrollData }, @Req() r: AuthRequest) { return this.s.savePayroll(u, year, b, clientIp(r)); }
  @Put('movements/:date') saveMovement(@CurrentUser() u: AuthUser, @Param('date') date: string, @Body(new ZodPipe(staffingMovementSaveSchema)) b: { version?: number; data: StaffingMovementDayData }, @Req() r: AuthRequest) { return this.s.saveMovementDay(u, date, b, clientIp(r)); }
  @Post('import-source') importSource(@CurrentUser() u: AuthUser, @Req() r: AuthRequest) { return this.s.importSource(u, clientIp(r)); }
  @Get('editors') editors(@CurrentUser() u: AuthUser) { return this.s.editors(u); }
  @Put('editors') setEditors(@CurrentUser() u: AuthUser, @Body(new ZodPipe(staffingEditorsSchema)) b: { userIds: number[] }, @Req() r: AuthRequest) { return this.s.setEditors(u, b.userIds, clientIp(r)); }
  @Get('journal') journal(@CurrentUser() u: AuthUser) { return this.s.journal(u); }
}
