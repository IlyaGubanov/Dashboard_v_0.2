import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canEditDelayReason, delayReasonSettingsSchema, delayResponsibleIds, riskLevel, type DelayReasonAdmin, type DelayReasonSave, type DelayReasonSettings, type DelayReasonsSheet } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';
import { loadDirection, loadPeriods } from '../kpi/loader';
import { calcSite, linear, planDateFor } from '../kpi/engine';
import { objectReportPeriods } from '../kpi/report-programs';
import { isoDate } from '../kpi/model';
import { reportProgramScope } from './program-scope';

@Injectable()
export class DelayReasonsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private async direction(user: AuthUser, code: string) {
    const d = await this.prisma.direction.findUnique({ where: { code } });
    if (!d || code === 'reb') throw new NotFoundException('Направление не найдено');
    await this.access.assertViewDirection(user, d.id);
    return d;
  }

  async admin(user: AuthUser, code: string): Promise<DelayReasonAdmin> {
    if (user.globalRole !== 'ADMIN') throw new ForbiddenException('Настройки доступны администратору');
    const d = await this.direction(user, code);
    const [users, workTypes] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, OR: [{ globalRole: 'ADMIN' }, { memberships: { some: { directionId: d.id } } }] }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
      this.prisma.workType.findMany({ where: { directionId: d.id }, select: { id: true, name: true, isArchived: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
    ]);
    return { settings: this.settings(d.settings), users, workTypes: workTypes.map(w => ({ id: w.id, name: `${w.name}${w.isArchived ? ' (архив)' : ''}` })) };
  }

  private settings(value: Prisma.JsonValue | null): DelayReasonSettings {
    return delayReasonSettingsSchema.parse((value as { delayReasons?: unknown } | null)?.delayReasons ?? {});
  }

  async configure(user: AuthUser, code: string, body: DelayReasonSettings, ip: string | null) {
    const options = await this.admin(user, code);
    const userIds = new Set(options.users.map(u => u.id)), typeIds = new Set(options.workTypes.map(t => t.id));
    if ([...body.defaultResponsibleIds, ...body.workTypes.flatMap(t => t.responsibleIds)].some(id => !userIds.has(id))) throw new BadRequestException('Выберите активных сотрудников, имеющих доступ к направлению');
    if (body.workTypes.some(t => !typeIds.has(t.workTypeId))) throw new BadRequestException('Вид работ не относится к направлению');
    const d = await this.direction(user, code);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM direction WHERE id = ${d.id} FOR UPDATE`;
      const live = await tx.direction.findUniqueOrThrow({ where: { id: d.id } });
      await tx.direction.update({ where: { id: d.id }, data: { settings: { ...((live.settings ?? {}) as Prisma.JsonObject), delayReasons: body } } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'delay_reason_settings', entityId: d.id, directionId: d.id, before: this.settings(live.settings), after: body, comment: 'Ответственные за причины отставания', ip }, tx);
    });
    return { ok: true };
  }

  async sheet(user: AuthUser, code: string, query: { date?: string; periodId?: number } = {}): Promise<DelayReasonsSheet> {
    const d = await this.direction(user, code);
    const s = this.settings(d.settings);
    const periods = await loadPeriods(this.prisma, d.id);
    const selected = query.periodId == null ? null : periods.find(p => p.id === query.periodId);
    if (query.periodId != null && !selected) throw new NotFoundException('Отчётная точка не найдена');
    const until = selected?.date ?? (query.date ? Date.parse(`${query.date}T00:00:00Z`) : Infinity);
    if (query.date && (!/^\d{4}-\d{2}-\d{2}$/.test(query.date) || !Number.isFinite(until) || isoDate(until) !== query.date)) throw new BadRequestException('Неверная дата среза');
    const own = periods.filter(p => p.date <= until);
    const [dir, items, reasons, role, explicitSites] = await Promise.all([
      loadDirection(this.prisma, d.id, periods, own.map(p => p.id)),
      this.prisma.workItem.findMany({ where: { isArchived: false, site: { directionId: d.id, isArchived: false } }, include: { workType: true, responsible: true, site: { include: { assignments: { where: { role: { in: ['ENTRY', 'CURATOR', 'RESPONSIBLE'] } }, include: { user: true } } } } } }),
      this.prisma.delayReason.findMany({ where: { period: { directionId: d.id, ...(Number.isFinite(until) ? { date: { lte: new Date(until) } } : {}) } }, include: { period: true, updatedBy: { select: { fullName: true } } }, orderBy: { period: { date: 'desc' } } }),
      this.access.roleIn(user, d.id),
      selected && d.periodKind === 'REPORT' ? this.prisma.site.findMany({ where: { directionId: d.id, ...reportProgramScope(selected.program, selected.id) }, select: { id: true } }) : null,
    ]);
    const explicitIds = explicitSites ? new Set(explicitSites.map(s => s.id)) : null;
    const byId = new Map(items.map(i => [i.id, i]));
    const users = await this.prisma.user.findMany({ where: { isActive: true, OR: [{ globalRole: 'ADMIN' }, { memberships: { some: { directionId: d.id } } }] }, select: { id: true, fullName: true } });
    const userById = new Map(users.map(u => [u.id, u]));
    const byItem = new Map<number, typeof reasons>();
    for (const reason of reasons) { const list = byItem.get(reason.workItemId) ?? []; list.push(reason); byItem.set(reason.workItemId, list); }
    const rows: DelayReasonsSheet['rows'] = [];
    for (const site of dir.sites) {
      const reportPeriods = d.periodKind === 'REPORT' ? objectReportPeriods(dir, site, until) : own;
      const p = selected ?? reportPeriods.at(-1) ?? null;
      if (explicitIds && !explicitIds.has(site.id)) continue;
      const at = p ?? { id: -1, date: Number.isFinite(until) ? until : Date.now(), status: 'LOCKED' as const, program: '', label: null };
      const planDate = planDateFor(dir, at);
      const calc = calcSite(dir, site, at, planDate);
      for (const i of calc.items) {
        const item = byId.get(i.item.id)!;
        const fallback = [item.responsibleId, ...item.site.assignments.map(a => a.userId)].filter((id): id is number => id != null);
        const assigned = delayResponsibleIds(s, item.workTypeId, fallback).filter(id => userById.has(id));
        const r = p ? byItem.get(item.id)?.find(r => r.period.program === p.program && r.period.date.getTime() <= p.date) : null;
        const plan = dir.planMethod === 'LINEAR_SITE_DATES' ? linear(site.planStart, site.planEnd, planDate) : i.plan;
        const delayed = !i.excluded && i.fact < 0.995 && (i.overdue || (plan != null && riskLevel((i.fact - plan) * 100, dir.thrWarn, dir.thrCrit) !== 'ok'));
        rows.push({ workItemId: item.id, siteId: site.id, workTypeId: item.workTypeId, name: item.label ?? item.workType.name, siteName: site.shortName,
          periodId: p?.id ?? null, periodDate: p ? isoDate(p.date) : null, program: p?.program ?? '', text: r?.text ?? '', version: r?.periodId === p?.id ? r?.version ?? 0 : 0,
          from: r ? r.period.date.toISOString().slice(0, 10) : null, updatedBy: r?.updatedBy?.fullName ?? null, updatedAt: r?.updatedAt.toISOString() ?? null,
          responsibles: assigned.map(id => userById.get(id)!), canEdit: !!p && canEditDelayReason(s, role, user.id, assigned, p.status), required: s.requireWhenDelayed && delayed, delayed });
      }
    }
    return { rows };
  }

  async save(user: AuthUser, code: string, periodId: number, workItemId: number, body: DelayReasonSave, ip: string | null) {
    const d = await this.direction(user, code);
    return this.prisma.$transaction(async tx => {
      // Общая блокировка с изменением статуса точки и сохранением факта.
      await tx.$queryRaw`SELECT id FROM reporting_period WHERE id = ${periodId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM work_item WHERE id = ${workItemId} FOR UPDATE`;
      const item = await tx.workItem.findUnique({ where: { id: workItemId }, include: { site: { select: { directionId: true, isArchived: true } } } });
      if (!item || item.isArchived || item.site.isArchived || item.site.directionId !== d.id) throw new NotFoundException('Работа не найдена или архивирована');
      const sheet = await this.sheet(user, code, { periodId });
      const row = sheet.rows.find(r => r.workItemId === workItemId);
      if (!row) throw new NotFoundException('Работа не относится к выбранной отчётной точке');
      if (!row.canEdit) throw new ForbiddenException('Заполнение доступно назначенным ответственным в открытой точке');
      if (row.required && !body.text) throw new BadRequestException('Укажите причину отставания от графика');
      const before = await tx.delayReason.findUnique({ where: { workItemId_periodId: { workItemId, periodId } } });
      if ((before?.version ?? 0) !== body.version) throw new ConflictException('Причина уже изменена другим сотрудником. Обновите данные и повторите правку.');
      const data = { text: body.text, updatedById: user.id };
      const after = before ? await tx.delayReason.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.delayReason.create({ data: { ...data, workItemId, periodId } });
      await this.audit.write({ userId: user.id, action: before ? 'UPDATE' : 'CREATE', entity: 'delay_reason', entityId: after.id, directionId: d.id, siteId: row.siteId,
        before: before ? { text: before.text } : null, after: { text: after.text, periodId }, comment: `${row.name} · причина отставания · ${row.periodDate}`, ip }, tx);
      return { version: after.version };
    }, { timeout: 60_000 });
  }
}
