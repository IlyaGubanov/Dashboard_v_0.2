import { Module } from '@nestjs/common';
import { KpiModule } from '../kpi/kpi.module';
import { AuthModule } from '../auth/auth.module';
import { ObjectsMapController } from './map.controller';
import { ObjectsMapService } from './map.service';

@Module({ imports: [KpiModule, AuthModule], controllers: [ObjectsMapController], providers: [ObjectsMapService] })
export class ObjectsMapModule {}
