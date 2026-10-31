import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';

@Module({imports:[AuthModule,KpiModule],controllers:[FleetController],providers:[FleetService],exports:[FleetService]})
export class FleetModule {}
