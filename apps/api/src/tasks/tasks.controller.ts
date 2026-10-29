import { Controller, Get } from '@nestjs/common';
import type { MyTasks } from '@mvs/shared';
import type { AuthUser } from '../common/request';
import { CurrentUser } from '../auth/decorators';
import { TasksService } from './tasks.service';

/** Напоминания текущему пользователю. */
@Controller('me')
export class TasksController {
  constructor(private readonly s: TasksService) {}

  @Get('tasks')
  tasks(@CurrentUser() u: AuthUser): Promise<MyTasks> {
    return this.s.forUser(u);
  }
}
