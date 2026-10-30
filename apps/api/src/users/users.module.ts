import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { DepartmentsController } from './departments.controller';
import { UsersService } from './users.service';
import { UsersImportService } from './users-import.service';

@Module({
  controllers: [UsersController, DepartmentsController],
  providers: [UsersService, UsersImportService],
})
export class UsersModule {}
