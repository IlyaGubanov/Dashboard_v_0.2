import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { FleetImportService } from './fleet-import.service';
import { FleetImportController } from './fleet-import.controller';

@Module({imports:[AuthModule,KpiModule],controllers:[FleetController,FleetImportController],providers:[FleetService,FleetImportService],exports:[FleetService]})
export class FleetModule {}
