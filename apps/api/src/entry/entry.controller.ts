import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { entrySaveSchema, periodCreateSchema, periodStatusSchema, type AuditPage, type EntrySaveData, type EntrySaveResult, type EntrySheet } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser } from '../auth/decorators';
import { EntryService } from './entry.service';
import { reportSummarySaveSchema, type ReportSummarySave } from '@mvs/shared';

const optInt = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const optDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

@Controller('directions/:code')
export class EntryController {
  constructor(private readonly entry: EntryService) {}

  /** Лист ввода за отчётную точку. */
  @Get('entry/:periodId')
  sheet(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('periodId', ParseIntPipe) periodId: number): Promise<EntrySheet> {
    return this.entry.sheet(user, code, periodId);
  }

  /** Сохранить изменения (все или ничего; при одновременной правке — 409). */
  @Put('entry/:periodId')
  save(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('periodId', ParseIntPipe) periodId: number,
    @Body(new ZodPipe(entrySaveSchema)) body: EntrySaveData,
    @Req() req: AuthRequest,
  ): Promise<EntrySaveResult> {
    return this.entry.save(user, code, periodId, body, clientIp(req));
  }

  /** Открыть новую отчётную точку. */
  @Put('periods/:periodId/summary')
  summary(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('periodId', ParseIntPipe) periodId: number,
    @Body(new ZodPipe(reportSummarySaveSchema)) body: ReportSummarySave, @Req() req: AuthRequest) {
    return this.entry.saveSummary(user, code, periodId, body, clientIp(req));
  }

  /** Открыть новую отчётную точку. */
  @Post('periods')
  openPeriod(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(periodCreateSchema)) body: z.output<typeof periodCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.entry.openPeriod(user, code, body.date, clientIp(req), body.program);
  }

  /** Закрыть / вернуть в работу / заблокировать отчётную точку. */
  @Post('periods/:periodId/status')
  @HttpCode(200)
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('periodId', ParseIntPipe) periodId: number,
    @Body(new ZodPipe(periodStatusSchema)) body: z.output<typeof periodStatusSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.entry.setPeriodStatus(user, code, periodId, body.status, body.comment, clientIp(req));
  }

  /** Журнал изменений направления. */
  @Get('audit')
  audit(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Query('userId') userId?: string,
    @Query('siteId') siteId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<AuditPage> {
    return this.entry.auditLog(user, code, {
      userId: optInt(userId),
      siteId: optInt(siteId),
      from: optDate(from),
      to: optDate(to),
      skip: optInt(skip),
      take: optInt(take),
    });
  }
}
