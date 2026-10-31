import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StaffingPeriod as PeriodRecord, type StaffingPayroll as PayrollRecord } from '@prisma/client';
import { staffingPeriodSchema, staffingPayrollSchema, type StaffingPeriod, type StaffingPeriodData, type StaffingPayroll, type StaffingPayrollData, type StaffingView, type StaffingEditors } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';
import source from './source.json';

const json = (data: unknown) => JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
const period = (r: PeriodRecord): StaffingPeriod => ({ ...staffingPeriodSchema.parse(r.data), version: r.version, isArchived: r.isArchived, updatedAt: r.updatedAt.toISOString() });
const payroll = (r: PayrollRecord): StaffingPayroll => ({ ...staffingPayrollSchema.parse(r.data), version: r.version, updatedAt: r.updatedAt.toISOString() });
const unique = (e: unknown): never => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Такой период уже существует. Откройте его для редактирования.'); throw e; };

@Injectable()
export class StaffingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService) {}

  async view(user: AuthUser): Promise<StaffingView> {
    const permissions = await this.access.assertStaffing(user);
    const [periods, years] = await Promise.all([
      this.prisma.staffingPeriod.findMany({ orderBy: { month: 'asc' } }),
      this.access.has(user, 'finance') ? this.prisma.staffingPayroll.findMany({ orderBy: { year: 'asc' } }) : [],
    ]);
    return { periods: periods.map(period), payroll: years.map(payroll), permissions, canExport: this.access.has(user, 'export'), canAudit: this.access.has(user, 'audit'), canFinance: this.access.has(user, 'finance') };
  }

  async create(user: AuthUser, data: StaffingPeriodData, ip: string | null) {
    await this.access.assertStaffing(user, true);
    try {
      return await this.prisma.$transaction(async tx => {
        const r = await tx.staffingPeriod.create({ data: { month: data.month, data: json(data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_period', entityId: data.month, after: period(r), ip }, tx);
        return period(r);
      });
    } catch (e) { unique(e); }
  }

  async save(user: AuthUser, month: string, input: { version: number; data: StaffingPeriodData; isArchived?: boolean }, ip: string | null) {
    await this.access.assertStaffing(user, true);
    if (month !== input.data.month) throw new BadRequestException('Месяц существующего среза изменить нельзя');
    return this.prisma.$transaction(async tx => {
      const before = await tx.staffingPeriod.findUnique({ where: { month } });
      if (!before) throw new NotFoundException('Срез не найден');
      const changed = await tx.staffingPeriod.updateMany({ where: { month, version: input.version }, data: { data: json(input.data), isArchived: input.isArchived, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Данные изменил другой пользователь. Обновите раздел и повторите правку.');
      const after = await tx.staffingPeriod.findUniqueOrThrow({ where: { month } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_period', entityId: month, before: period(before), after: period(after), comment: input.isArchived === true ? 'Срез в архиве' : input.isArchived === false ? 'Срез восстановлен' : 'Редактирование среза', ip }, tx);
      return period(after);
    });
  }

  async createPayroll(user: AuthUser, data: StaffingPayrollData, ip: string | null) {
    await this.access.assertStaffing(user, true);
    this.access.assertFeature(user, 'finance');
    try {
      return await this.prisma.$transaction(async tx => {
        const r = await tx.staffingPayroll.create({ data: { year: data.year, data: json(data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_payroll', entityId: data.year, after: payroll(r), ip }, tx);
        return payroll(r);
      });
    } catch (e) { unique(e); }
  }

  async savePayroll(user: AuthUser, year: number, input: { version: number; data: StaffingPayrollData }, ip: string | null) {
    await this.access.assertStaffing(user, true);
    this.access.assertFeature(user, 'finance');
    if (year !== input.data.year) throw new BadRequestException('Год существующего ФОТ изменить нельзя');
    return this.prisma.$transaction(async tx => {
      const before = await tx.staffingPayroll.findUnique({ where: { year } });
      if (!before) throw new NotFoundException('Год ФОТ не найден');
      const changed = await tx.staffingPayroll.updateMany({ where: { year, version: input.version }, data: { data: json(input.data), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('ФОТ изменил другой пользователь. Обновите раздел и повторите правку.');
      const after = await tx.staffingPayroll.findUniqueOrThrow({ where: { year } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_payroll', entityId: year, before: payroll(before), after: payroll(after), ip }, tx);
      return payroll(after);
    });
  }

  /** Первичная загрузка никогда не перезаписывает существующие периоды, в том числе архивные. */
  async importSource(user: AuthUser, ip: string | null) {
    await this.access.assertStaffing(user, true);
    this.access.assertFeature(user, 'finance');
    return this.prisma.$transaction(async tx => {
      let added = 0;
      for (const input of source.periods) {
        const data = staffingPeriodSchema.parse(input);
        if (await tx.staffingPeriod.findUnique({ where: { month: data.month } })) continue;
        await tx.staffingPeriod.create({ data: { month: data.month, data: json(data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_period', entityId: data.month, after: data, comment: `Импорт: ${source.source}, ${source.sheet}`, ip }, tx);
        added++;
      }
      for (const input of source.payroll) {
        const data = staffingPayrollSchema.parse(input);
        if (await tx.staffingPayroll.findUnique({ where: { year: data.year } })) continue;
        await tx.staffingPayroll.create({ data: { year: data.year, data: json(data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_payroll', entityId: data.year, after: data, comment: `Импорт: ${source.source}`, ip }, tx);
        added++;
      }
      return { added };
    });
  }

  async editors(user: AuthUser): Promise<StaffingEditors> {
    if (!(await this.access.staffingPermissions(user)).canManageEditors) throw new ForbiddenException('Назначать ответственных может администратор или куратор направления');
    const [users, editors] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, canLogin: true }, select: { id: true, fullName: true, login: true }, orderBy: { fullName: 'asc' } }),
      this.prisma.staffingEditor.findMany(),
    ]);
    return { users, userIds: editors.map(e => e.userId) };
  }

  async setEditors(user: AuthUser, userIds: number[], ip: string | null) {
    if (!(await this.access.staffingPermissions(user)).canManageEditors) throw new ForbiddenException('Назначать ответственных может администратор или куратор направления');
    const ids = [...new Set(userIds)];
    if (await this.prisma.user.count({ where: { id: { in: ids }, isActive: true, canLogin: true } }) !== ids.length) throw new BadRequestException('Выберите действующих пользователей со входом в систему');
    await this.prisma.$transaction(async tx => {
      // Блокировка общей строки сериализует одновременное назначение ответственных.
      await tx.appSetting.upsert({ where: { key: 'staffing.editors.lock' }, create: { key: 'staffing.editors.lock', value: {} }, update: { value: {} } });
      const before = await tx.staffingEditor.findMany();
      await tx.staffingEditor.deleteMany();
      if (ids.length) await tx.staffingEditor.createMany({ data: ids.map(userId => ({ userId })) });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_editors', entityId: 'editors', before: before.map(r => r.userId), after: ids, ip }, tx);
    });
    return this.editors(user);
  }

  async journal(user: AuthUser) {
    await this.access.assertStaffing(user);
    this.access.assertFeature(user, 'audit');
    const entities = ['staffing_period', ...(this.access.has(user, 'finance') ? ['staffing_payroll'] : []), ...(user.globalRole === 'ADMIN' ? ['staffing_editors'] : [])];
    const rows = await this.prisma.auditLog.findMany({ where: { entity: { in: entities } }, take: 100, orderBy: { id: 'desc' }, include: { user: { select: { fullName: true } } } });
    return rows.map(r => ({ id: String(r.id), at: r.at.toISOString(), user: r.user?.fullName ?? 'Система', action: r.action, entityId: r.entityId, comment: r.comment }));
  }
}
