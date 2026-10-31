import { Body, Controller, Get, Injectable, Put, Req } from '@nestjs/common';
import { appearanceSchema, mergeAppearance, type Appearance } from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const KEY = 'ui.appearance';

@Injectable()
export class AppearanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<Appearance> {
    const s = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    return mergeAppearance(s?.value);
  }

  async set(user: AuthUser, v: Appearance, ip: string | null) {
    const before = await this.get();
    await this.prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: v }, update: { value: v } });
    await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'app_setting', entityId: KEY, before, after: v, ip });
    return v;
  }
}

/** Оформление: читать может любой (нужно и на странице входа), менять — только администратор. */
@Controller()
export class AppearanceController {
  constructor(private readonly s: AppearanceService) {}

  @Public()
  @Get('appearance')
  get() {
    return this.s.get();
  }

  @Roles('ADMIN')
  @Put('admin/appearance')
  set(@CurrentUser() u: AuthUser, @Body(new ZodPipe(appearanceSchema)) b: Appearance, @Req() r: AuthRequest) {
    return this.s.set(u, b, clientIp(r));
  }
}
