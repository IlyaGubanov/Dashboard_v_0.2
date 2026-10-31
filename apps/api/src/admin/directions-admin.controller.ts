import { Body, Controller, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import { directionSchema, fieldsSchema, kpisSchema, overviewThresholdsSchema, overviewTilesSchema, statusesSchema, trackerDefSchema, METRIC_CATALOG, type DirectionData, type DirectionDef } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser, Roles } from '../auth/decorators';
import { DirectionsAdminService } from './directions-admin.service';

/** Конструктор направлений — только администратор. */
@Roles('ADMIN')
@Controller('admin')
export class DirectionsAdminController {
  constructor(private readonly s: DirectionsAdminService) {}

  @Get('directions')
  list() {
    return this.s.list();
  }

  @Get('directions/:code')
  get(@Param('code') code: string): Promise<DirectionDef> {
    return this.s.get(code);
  }

  @Post('directions')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(directionSchema)) b: DirectionData, @Req() r: AuthRequest) {
    return this.s.create(u, b, clientIp(r));
  }

  @Patch('directions/:code')
  update(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(directionSchema)) b: DirectionData, @Req() r: AuthRequest) {
    return this.s.update(u, code, b, clientIp(r));
  }

  @Put('directions/:code/statuses')
  statuses(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(statusesSchema)) b: z.output<typeof statusesSchema>, @Req() r: AuthRequest) {
    return this.s.saveStatuses(u, code, b, clientIp(r));
  }

  @Put('directions/:code/fields')
  fields(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(fieldsSchema)) b: z.output<typeof fieldsSchema>, @Req() r: AuthRequest) {
    return this.s.saveFields(u, code, b, clientIp(r));
  }

  @Put('directions/:code/trackers/:tracker')
  tracker(
    @CurrentUser() u: AuthUser,
    @Param('code') code: string,
    @Param('tracker') tracker: string,
    @Body(new ZodPipe(trackerDefSchema)) b: z.output<typeof trackerDefSchema>,
    @Req() r: AuthRequest,
  ) {
    return this.s.saveTracker(u, code, tracker, b, clientIp(r));
  }

  @Put('directions/:code/kpis')
  kpis(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(kpisSchema)) b: z.output<typeof kpisSchema>, @Req() r: AuthRequest) {
    return this.s.saveKpis(u, code, b, clientIp(r));
  }

  @Put('directions/:code/tiles')
  tiles(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(overviewTilesSchema)) b: z.output<typeof overviewTilesSchema>, @Req() r: AuthRequest) {
    return this.s.saveTiles(u, code, b, clientIp(r));
  }

  @Get('metrics')
  metrics() {
    return METRIC_CATALOG;
  }

  @Get('settings/overview')
  thresholds() {
    return this.s.getOverviewThresholds();
  }

  @Put('settings/overview')
  setThresholds(@CurrentUser() u: AuthUser, @Body(new ZodPipe(overviewThresholdsSchema)) b: z.output<typeof overviewThresholdsSchema>, @Req() r: AuthRequest) {
    return this.s.setOverviewThresholds(u, b, clientIp(r));
  }
}
