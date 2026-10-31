import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffingController } from './staffing.controller';
import { StaffingService } from './staffing.service';

@Module({ imports: [AuthModule], controllers: [StaffingController], providers: [StaffingService] })
export class StaffingModule {}
