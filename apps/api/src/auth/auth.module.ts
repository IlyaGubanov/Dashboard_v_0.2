import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessService } from './access.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessService],
  exports: [AuthService, AccessService],
})
export class AuthModule {}
