import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DirectionsController } from './directions.controller';
import { DirectionsService } from './directions.service';

@Module({
  imports: [AuthModule],
  controllers: [DirectionsController],
  providers: [DirectionsService],
})
export class DirectionsModule {}
