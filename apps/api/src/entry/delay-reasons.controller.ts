import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, Req } from '@nestjs/common';
import { delayReasonSaveSchema, delayReasonSettingsSchema, type DelayReasonSave, type DelayReasonSettings } from '@mvs/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DelayReasonsService } from './delay-reasons.service';

@Controller()
export class DelayReasonsController {
  constructor(private readonly reasons: DelayReasonsService) {}
  @Get('directions/:code/delay-reasons')
  sheet(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('date') date?: string, @Query('periodId', new ParseIntPipe({ optional: true })) periodId?: number) {
    return this.reasons.sheet(user, code, { date, periodId });
  }
  @Put('directions/:code/delay-reasons/:periodId/:workItemId')
  save(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('periodId', ParseIntPipe) periodId: number, @Param('workItemId', ParseIntPipe) workItemId: number,
    @Body(new ZodPipe(delayReasonSaveSchema)) body: DelayReasonSave, @Req() req: AuthRequest) {
    return this.reasons.save(user, code, periodId, workItemId, body, clientIp(req));
  }
  @Roles('ADMIN')
  @Get('admin/directions/:code/delay-reasons')
  admin(@CurrentUser() user: AuthUser, @Param('code') code: string) { return this.reasons.admin(user, code); }
  @Roles('ADMIN')
  @Put('admin/directions/:code/delay-reasons')
  configure(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body(new ZodPipe(delayReasonSettingsSchema)) body: DelayReasonSettings, @Req() req: AuthRequest) {
    return this.reasons.configure(user, code, body, clientIp(req));
  }
}
