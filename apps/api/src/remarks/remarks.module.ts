import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { RemarksController } from './remarks.controller';
import { RemarksService } from './remarks.service';

@Module({
  imports: [AuthModule, KpiModule],
  controllers: [RemarksController],
  providers: [RemarksService],
})
export class RemarksModule {}
