import { Module } from '@nestjs/common';
import { KpiModule } from '../kpi/kpi.module';
import { ObjectsMapController } from './map.controller';
import { ObjectsMapService } from './map.service';

@Module({ imports: [KpiModule], controllers: [ObjectsMapController], providers: [ObjectsMapService] })
export class ObjectsMapModule {}
