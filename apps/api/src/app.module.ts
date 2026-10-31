import { Module } from '@nestjs/common';
import { ObjectsMapModule } from './map/map.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { RolesGuard } from './auth/roles.guard';
import { UsersModule } from './users/users.module';
import { DirectionsModule } from './directions/directions.module';
import { KpiModule } from './kpi/kpi.module';
import { EntryModule } from './entry/entry.module';
import { ManageModule } from './manage/manage.module';
import { AdminModule } from './admin/admin.module';
import { RemarksModule } from './remarks/remarks.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { TasksModule } from './tasks/tasks.module';
import { ContractorsModule } from './contractors/contractors.module';
import { AppearanceModule } from './appearance/appearance.module';
import { HealthController } from './health.controller';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    ObjectsMapModule,
    // общий лимит запросов; для входа — строже (см. AuthController)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    DirectionsModule,
    KpiModule,
    EntryModule,
    ManageModule,
    AdminModule,
    RemarksModule,
    AttachmentsModule,
    TasksModule,
    ContractorsModule,
    AppearanceModule,
    VideoModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // порядок важен: сначала определяем пользователя, затем проверяем роль
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
