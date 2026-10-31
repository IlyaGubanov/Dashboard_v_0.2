import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { EconomicsController } from './economics.controller';
import { EconomicsService } from './economics.service';
import { EconomicsDemoService } from './economics-demo.service';
import { EconomicsCashService } from './economics-cash.service';

@Module({ imports: [AuthModule, KpiModule], controllers: [EconomicsController], providers: [EconomicsService, EconomicsDemoService, EconomicsCashService] })
export class EconomicsModule {}
