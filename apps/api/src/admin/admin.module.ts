import { Module } from '@nestjs/common';
import { KpiModule } from '../kpi/kpi.module';
import { DirectionsAdminController } from './directions-admin.controller';
import { DirectionsAdminService } from './directions-admin.service';

@Module({
  imports: [KpiModule],
  controllers: [DirectionsAdminController],
  providers: [DirectionsAdminService],
})
export class AdminModule {}
