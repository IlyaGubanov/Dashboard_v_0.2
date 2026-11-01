import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StaffingPeriod as PeriodRecord, type StaffingPayroll as PayrollRecord, type StaffingMovementDay as MovementRecord } from '@prisma/client';
import { staffingChangeSummary, staffingLinkPositions, staffingMovementDaySchema, staffingPeriodSchema, staffingPayrollSchema, staffingRenameGroup, staffingRenameGroupInDay, type StaffingGroupRename, type StaffingMovementDay, type StaffingMovementDayData, type StaffingPeriod, type StaffingPeriodData, type StaffingPayroll, type StaffingPayrollData, type StaffingView, type StaffingEditors } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';
import source from './source.json';

const json = (data: unknown) => JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
/** Срез из базы: должности всегда связаны с подразделениями, в том числе загруженные до появления связи. */
const period = (r: PeriodRecord): StaffingPeriod => ({ ...staffingLinkPositions(staffingPeriodSchema.parse(r.data)), version: r.version, isArchived: r.isArchived, updatedAt: r.updatedAt.toISOString() });
const payroll = (r: PayrollRecord): StaffingPayroll => ({ ...staffingPayrollSchema.parse(r.data), version: r.version, updatedAt: r.updatedAt.toISOString() });
const movement = (r: MovementRecord): StaffingMovementDay => ({ ...staffingMovementDaySchema.parse(r.data), version: r.version, updatedAt: r.updatedAt.toISOString() });
const unique = (e: unknown): never => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Такой период уже существует. Откройте его для редактирования.'); throw e; };

@Injectable()
export class StaffingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService) {}

  async view(user: AuthUser): Promise<StaffingView> {
    const permissions = await this.access.assertStaffing(user);
    const [periods, years, days] = await Promise.all([
      this.prisma.staffingPeriod.findMany({ orderBy: { month: 'asc' } }),
      this.access.has(user, 'finance') ? this.prisma.staffingPayroll.findMany({ orderBy: { year: 'asc' } }) : [],
      this.prisma.staffingMovementDay.findMany({ orderBy: { date: 'asc' } }),
    ]);
    return { periods: periods.map(period), payroll: years.map(payroll), movements: days.map(movement), permissions, canExport: this.access.has(user, 'export'), canAudit: this.access.has(user, 'audit'), canFinance: this.access.has(user, 'finance') };
  }

  async create(user: AuthUser, input: StaffingPeriodData, ip: string | null) {
    await this.access.assertStaffing(user, true);
    const data = staffingLinkPositions(input);
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
    const data = staffingLinkPositions(input.data);
    return this.prisma.$transaction(async tx => {
      const before = await tx.staffingPeriod.findUnique({ where: { month } });
      if (!before) throw new NotFoundException('Срез не найден');
      const changed = await tx.staffingPeriod.updateMany({ where: { month, version: input.version }, data: { data: json(data), isArchived: input.isArchived, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Данные изменил другой пользователь. Обновите раздел и повторите правку.');
      const after = await tx.staffingPeriod.findUniqueOrThrow({ where: { month } });
      const comment = input.isArchived === true ? 'Срез в архиве' : input.isArchived === false ? 'Срез восстановлен' : staffingChangeSummary(period(before), period(after)) || 'Сохранено без изменений';
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_period', entityId: month, before: period(before), after: period(after), comment, ip }, tx);
      return period(after);
    });
  }

  /** Переименование или объединение групп: в одном срезе либо во всех срезах и днях приёма/увольнения. Всё или ничего: при чужой правке — 409. */
  async renameGroup(user: AuthUser, input: StaffingGroupRename, ip: string | null) {
    await this.access.assertStaffing(user, true);
    const { from, to, month } = input;
    const comment = `Группа «${from}» → «${to}»`;
    return this.prisma.$transaction(async tx => {
      const conflict = () => new ConflictException('Данные изменил другой пользователь. Обновите раздел и повторите.');
      let periods = 0, days = 0;
      for (const r of await tx.staffingPeriod.findMany({ where: month ? { month } : {} })) {
        const before = period(r);
        const next = staffingRenameGroup(staffingPeriodSchema.parse(r.data), from, to);
        if (!next) continue;
        if (!(await tx.staffingPeriod.updateMany({ where: { month: r.month, version: r.version }, data: { data: json(next), version: { increment: 1 } } })).count) throw conflict();
        await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_period', entityId: r.month, before, after: next, comment, ip }, tx);
        periods++;
      }
      if (!month) for (const r of await tx.staffingMovementDay.findMany()) {
        const next = staffingRenameGroupInDay(staffingMovementDaySchema.parse(r.data), from, to);
        if (!next) continue;
        if (!(await tx.staffingMovementDay.updateMany({ where: { date: r.date, version: r.version }, data: { data: json(next), version: { increment: 1 } } })).count) throw conflict();
        await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_movement', entityId: r.date, before: movement(r), after: next, comment, ip }, tx);
        days++;
      }
      if (!periods && !days) throw new NotFoundException(`Группа «${from}» не найдена`);
      return { periods, days };
    }, { timeout: 60_000 });
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

  /** День приёма и увольнения: без version — создание (если день уже внесён — 409), с version — правка с проверкой версии. */
  async saveMovementDay(user: AuthUser, date: string, input: { version?: number; data: StaffingMovementDayData }, ip: string | null) {
    await this.access.assertStaffing(user, true);
    if (date !== input.data.date) throw new BadRequestException('Дату внесённого дня изменить нельзя');
    return this.prisma.$transaction(async tx => {
      const before = await tx.staffingMovementDay.findUnique({ where: { date } });
      if (input.version == null) {
        if (before) throw new ConflictException('За этот день данные уже внесены. Обновите раздел и откройте день для правки.');
        const r = await tx.staffingMovementDay.create({ data: { date, data: json(input.data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_movement', entityId: date, after: movement(r), comment: 'Приём и увольнение за день', ip }, tx);
        return movement(r);
      }
      if (!before) throw new NotFoundException('День не найден');
      const changed = await tx.staffingMovementDay.updateMany({ where: { date, version: input.version }, data: { data: json(input.data), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Данные за день изменил другой пользователь. Обновите раздел и повторите правку.');
      const after = await tx.staffingMovementDay.findUniqueOrThrow({ where: { date } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_movement', entityId: date, before: movement(before), after: movement(after), comment: 'Правка приёма и увольнения', ip }, tx);
      return movement(after);
    });
  }

  /** Первичная загрузка никогда не перезаписывает существующие данные: добавляет отсутствующие срезы, дни приёма/увольнения и должности в срез без должностей. */
  async importSource(user: AuthUser, ip: string | null) {
    await this.access.assertStaffing(user, true);
    this.access.assertFeature(user, 'finance');
    return this.prisma.$transaction(async tx => {
      let added = 0;
      for (const input of source.periods) {
        const data = staffingPeriodSchema.parse(input);
        const existing = await tx.staffingPeriod.findUnique({ where: { month: data.month } });
        if (existing) {
          const current = period(existing);
          if (!data.positions?.length || current.positions?.length) continue;
          const after = await tx.staffingPeriod.update({ where: { month: data.month }, data: { data: json({ ...staffingPeriodSchema.parse(existing.data), positions: data.positions }), version: { increment: 1 } } });
          await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'staffing_period', entityId: data.month, before: current, after: period(after), comment: `Импорт должностей: ${source.source}`, ip }, tx);
          added++;
          continue;
        }
        await tx.staffingPeriod.create({ data: { month: data.month, data: json(data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_period', entityId: data.month, after: data, comment: `Импорт: ${source.source}, ${source.sheet}`, ip }, tx);
        added++;
      }
      for (const input of source.movements ?? []) {
        const data = staffingMovementDaySchema.parse(input);
        if (await tx.staffingMovementDay.findUnique({ where: { date: data.date } })) continue;
        await tx.staffingMovementDay.create({ data: { date: data.date, data: json(data) } });
        await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'staffing_movement', entityId: data.date, after: data, comment: `Импорт: ${source.source}, «Приемыувольнения»`, ip }, tx);
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
    const entities = ['staffing_period', 'staffing_movement', ...(this.access.has(user, 'finance') ? ['staffing_payroll'] : []), ...(user.globalRole === 'ADMIN' ? ['staffing_editors'] : [])];
    const rows = await this.prisma.auditLog.findMany({ where: { entity: { in: entities } }, take: 300, orderBy: { id: 'desc' }, include: { user: { select: { fullName: true } } } });
    return rows.map(r => ({ id: String(r.id), at: r.at.toISOString(), user: r.user?.fullName ?? 'Система', action: r.action, entityId: r.entityId, comment: r.comment }));
  }
}
