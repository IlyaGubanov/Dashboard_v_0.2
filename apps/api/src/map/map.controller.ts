import { Controller, Get } from '@nestjs/common';
import type { ObjectsMap } from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/request';
import { ObjectsMapService } from './map.service';

@Controller('map')
export class ObjectsMapController {
  constructor(private readonly map: ObjectsMapService) {}
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ObjectsMap> { return this.map.list(user); }
}
