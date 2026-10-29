import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { remarkActionSchema, remarkSchema, type RemarkActionData, type RemarkCard, type RemarkData, type RemarkList } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser } from '../auth/decorators';
import { RemarksService } from './remarks.service';

/** Замечания по объектам направления. */
@Controller('directions/:code/remarks')
export class RemarksController {
  constructor(private readonly s: RemarksService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('code') code: string): Promise<RemarkList> {
    return this.s.list(u, code);
  }

  @Get(':id')
  card(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number): Promise<RemarkCard> {
    return this.s.card(u, code, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(remarkSchema)) b: RemarkData, @Req() r: AuthRequest) {
    return this.s.create(u, code, b, clientIp(r));
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(remarkSchema)) b: RemarkData, @Req() r: AuthRequest) {
    return this.s.update(u, code, id, b, clientIp(r));
  }

  @Post(':id/actions')
  @HttpCode(200)
  act(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(remarkActionSchema)) b: RemarkActionData, @Req() r: AuthRequest) {
    return this.s.act(u, code, id, b, clientIp(r));
  }
}
