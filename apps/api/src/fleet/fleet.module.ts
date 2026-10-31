import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';

@Module({imports:[AuthModule],controllers:[FleetController],providers:[FleetService],exports:[FleetService]})
export class FleetModule {}
