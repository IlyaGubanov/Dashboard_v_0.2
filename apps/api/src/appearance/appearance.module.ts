import { Module } from '@nestjs/common';
import { AppearanceController, AppearanceService } from './appearance.controller';

@Module({
  controllers: [AppearanceController],
  providers: [AppearanceService],
})
export class AppearanceModule {}
