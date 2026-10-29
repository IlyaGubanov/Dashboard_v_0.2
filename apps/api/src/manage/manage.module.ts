import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { ManageController } from './manage.controller';
import { ManageService } from './manage.service';

@Module({
  imports: [AuthModule, KpiModule],
  controllers: [ManageController],
  providers: [ManageService],
})
export class ManageModule {}
