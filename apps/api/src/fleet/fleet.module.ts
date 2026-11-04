import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { KpiModule } from '../kpi/kpi.module';
import { MachineryController, MachineryService } from './machinery.service';

@Module({imports:[AuthModule,KpiModule],controllers:[MachineryController,FleetController],providers:[FleetService,MachineryService],exports:[FleetService]})
export class FleetModule {}
