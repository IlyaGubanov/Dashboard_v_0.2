import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { EntryController } from './entry.controller';
import { EntryService } from './entry.service';
import { DelayReasonsController } from './delay-reasons.controller';
import { DelayReasonsService } from './delay-reasons.service';

@Module({
  imports: [AuthModule, KpiModule],
  controllers: [EntryController, DelayReasonsController],
  providers: [EntryService, DelayReasonsService],
})
export class EntryModule {}
