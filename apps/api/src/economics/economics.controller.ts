import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  econArticleSchema,
  econBudgetCreateSchema,
  econBudgetSaveSchema,
  econCashSaveSchema,
  econDeviationCreateSchema,
  econDeviationUpdateSchema,
  econEditorsSchema,
  econMonthSaveSchema,
  econMonthSchema,
  econMonthStatusSchema,
  econSettingsSchema,
  type EconArticleInput,
  type EconBudgetCreate,
  type EconBudgetSave,
  type EconCashSave,
  type EconDeviationCreate,
  type EconDeviationUpdate,
  type EconMonthSave,
  type EconMonthStatus,
  type EconSettings,
} from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { EconomicsService } from './economics.service';
import { EconomicsDemoService } from './economics-demo.service';
import { EconomicsCashService } from './economics-cash.service';
import { EconomicsDeviationsService } from './economics-deviations.service';

const year = (v: number) => {
  if (v < 2020 || v > 2099) throw new BadRequestException('Год — от 2020 до 2099');
  return v;
};
const month = (v: string) => {
  if (!econMonthSchema.safeParse(v).success) throw new BadRequestException('Месяц указывается в формате ГГГГ-ММ');
  return v;
};

@Controller('economics')
export class EconomicsController {
  constructor(private readonly s: EconomicsService, private readonly demo: EconomicsDemoService, private readonly cash: EconomicsCashService, private readonly dev: EconomicsDeviationsService) {}
  @Get('access') access(@CurrentUser() u: AuthUser) { return this.s.permissions(u); }
  @Get() setup(@CurrentUser() u: AuthUser) { return this.s.setup(u); }
  @Post('budgets') createBudget(@CurrentUser() u: AuthUser, @Body(new ZodPipe(econBudgetCreateSchema)) b: EconBudgetCreate, @Req() r: AuthRequest) { return this.s.createBudget(u, b, clientIp(r)); }
  @Put('budgets/:id') saveBudget(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(econBudgetSaveSchema)) b: EconBudgetSave, @Req() r: AuthRequest) { return this.s.saveBudget(u, id, b, clientIp(r)); }
  @Get('overview/:month') overview(@CurrentUser() u: AuthUser, @Param('month') m: string, @Query('dir') dir?: string) { return this.s.overview(u, month(m), Number(dir) > 0 ? Number(dir) : undefined); }
  @Get('months/:month') month(@CurrentUser() u: AuthUser, @Param('month') m: string) { return this.s.month(u, month(m)); }
  @Put('months/:month') saveMonth(@CurrentUser() u: AuthUser, @Param('month') m: string, @Body(new ZodPipe(econMonthSaveSchema)) b: EconMonthSave, @Req() r: AuthRequest) { return this.s.saveMonth(u, month(m), b, clientIp(r)); }
  @Put('months/:month/status') status(@CurrentUser() u: AuthUser, @Param('month') m: string, @Body(new ZodPipe(econMonthStatusSchema)) b: { status: EconMonthStatus; version: number }, @Req() r: AuthRequest) { return this.s.setMonthStatus(u, month(m), b, clientIp(r)); }
  @Post('articles') createArticle(@CurrentUser() u: AuthUser, @Body(new ZodPipe(econArticleSchema)) b: EconArticleInput, @Req() r: AuthRequest) { return this.s.createArticle(u, b, clientIp(r)); }
  @Put('articles/:id') saveArticle(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(econArticleSchema)) b: EconArticleInput, @Req() r: AuthRequest) { return this.s.saveArticle(u, id, b, clientIp(r)); }
  @Put('settings') saveSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(econSettingsSchema)) b: EconSettings, @Req() r: AuthRequest) { return this.s.saveSettings(u, b, clientIp(r)); }
  @Get('editors') editors(@CurrentUser() u: AuthUser) { return this.s.editors(u); }
  @Put('editors') setEditors(@CurrentUser() u: AuthUser, @Body(new ZodPipe(econEditorsSchema)) b: { userIds: number[] }, @Req() r: AuthRequest) { return this.s.setEditors(u, b.userIds, clientIp(r)); }
  @Post('demo') loadDemo(@CurrentUser() u: AuthUser, @Req() r: AuthRequest) { return this.demo.load(u, clientIp(r)); }
  @Delete('demo') clearDemo(@CurrentUser() u: AuthUser, @Req() r: AuthRequest) { return this.demo.clear(u, clientIp(r)); }
  @Get('cash/:year') cashView(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) y: number) { return this.cash.view(u, year(y)); }
  @Put('cash/:year/:scope') cashSave(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) y: number, @Param('scope') scope: string, @Body(new ZodPipe(econCashSaveSchema)) b: EconCashSave, @Req() r: AuthRequest) { return this.cash.save(u, year(y), scope, b, clientIp(r)); }
  @Get('deviations/:month') deviations(@CurrentUser() u: AuthUser, @Param('month') m: string) { return this.dev.view(u, month(m)); }
  @Post('deviations') createDeviation(@CurrentUser() u: AuthUser, @Body(new ZodPipe(econDeviationCreateSchema)) b: EconDeviationCreate, @Req() r: AuthRequest) { return this.dev.create(u, b, clientIp(r)); }
  @Put('deviations/:id') updateDeviation(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(econDeviationUpdateSchema)) b: EconDeviationUpdate, @Req() r: AuthRequest) { return this.dev.update(u, id, b, clientIp(r)); }
  @Get('journal') journal(@CurrentUser() u: AuthUser) { return this.s.journal(u); }
}
