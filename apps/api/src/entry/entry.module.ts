import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KpiModule } from '../kpi/kpi.module';
import { EntryController } from './entry.controller';
import { EntryService } from './entry.service';

@Module({
  imports: [AuthModule, KpiModule],
  controllers: [EntryController],
  providers: [EntryService],
})
export class EntryModule {}
