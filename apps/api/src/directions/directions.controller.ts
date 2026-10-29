import { Controller, Get, Param } from '@nestjs/common';
import type { DirectionSummary } from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/request';
import { DirectionsService } from './directions.service';

@Controller('directions')
export class DirectionsController {
  constructor(private readonly directions: DirectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<DirectionSummary[]> {
    return this.directions.list(user);
  }

  @Get(':code/config')
  config(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.directions.config(user, code);
  }
}
