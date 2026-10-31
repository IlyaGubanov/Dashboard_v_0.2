/**
 * Ввод данных за отчётную точку: лист ввода, сохранение, открытие и закрытие точек, журнал изменений.
 *
 * Права:
 *   точка открыта   — ответственный за ввод (по своей области), куратор, администратор;
 *   точка закрыта   — куратор, администратор;
 *   заблокирована   — только администратор;
 *   направление «только просмотр» (данные приходят отчётами) — ручного ввода нет.
 * Одновременная правка: клиент присылает версию, которую видел; если запись за это время изменили — 409, ничего не сохраняется.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PeriodStatus } from '@prisma/client';
import type { AuditPage, EntryReportValue, EntrySaveData, EntrySaveResult, EntrySheet, EntryValue } from '@mvs/shared';
import { reportSummaryStoredSchema, type ReportSummarySave } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import { sheetNoFinance } from '../kpi/finance';
import type { AuthUser } from '../common/request';

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

const ITEM_FIELDS = ['statusCode', 'pct', 'factQty', 'ks', 'paid', 'note'] as const;
const REPORT_FIELDS = ['workers', 'machines', 'workersBlocked', 'machinesBlocked', 'ks', 'paid', 'note', 'statusText', 'remarksCount'] as const;
const FIELD_LABEL: Record<string, string> = {
  status: 'статус точки',
  statusCode: 'статус',
  pct: 'готовность, %',
  factQty: 'объём факт',
  ks: 'КС-2',
  paid: 'оплачено',
  note: 'примечание',
  workers: 'людей',
  machines: 'техники',
  workersBlocked: 'людей не допущено',
  machinesBlocked: 'техники не допущено',
  remarkStatus: 'статус замечания',
  text: 'текст',
  category: 'категория',
  severity: 'важность',
  dueDate: 'срок',
  assignee: 'исполнитель',
  object: 'объект',
  workItem: 'позиция',
  file: 'файл',
  source: 'источник', program: 'программа отчёта', date: 'дата отчёта', sheet: 'лист источника', attrs: 'исходные атрибуты отчёта', statusText: 'отчётный статус', remarksCount: 'замечаний по отчёту',
};

@Injectable()
export class EntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
  ) {}

  private async direction(user: AuthUser, code: string) {
    const d = await this.prisma.direction.findUnique({ where: { code }, include: { statusDefs: { where: { entity: 'WORK_ITEM' }, orderBy: { sort: 'asc' } } } });
    if (!d) throw new NotFoundException('Направление не найдено');
    await this.access.assertViewDirection(user, d.id);
    return d;
  }

  private async period(directionId: number, periodId: number) {
    const p = await this.prisma.reportingPeriod.findUnique({ where: { id: periodId } });
    if (!p || p.directionId !== directionId) throw new NotFoundException('Отчётная точка не найдена');
    return p;
  }

  private programScope(program: string, periodId: number): Prisma.SiteWhereInput {
    return { OR: [{ section: { code: program } }, { reports: { some: { periodId } } }, { workItems: { some: { progress: { some: { periodId } } } } }, { sectionId: null, reports: { some: { period: { program } } } }] };
  }

  /** Может ли роль править данные при этом статусе точки. */
  private statusAllows(role: string | null, status: PeriodStatus) {
    if (role === 'ADMIN') return true;
    if (status === 'LOCKED') return false;
    if (status === 'CLOSED') return role === 'CURATOR';
    return role === 'CURATOR' || role === 'EDITOR';
  }

  private reasonClosed(role: string | null, status: PeriodStatus, readonly: boolean) {
    if (readonly) return 'Данные направления приходят отчётами — ручной ввод не предусмотрен';
    if (!role || role === 'VIEWER') return 'У вас нет прав на ввод в этом направлении';
    if (status === 'LOCKED') return 'Точка заблокирована — правки только у администратора';
    if (status === 'CLOSED' && role === 'EDITOR') return 'Куратор закрыл точку — для правки попросите куратора вернуть её в работу';
    return null;
  }

  /** Лист ввода; без доступа к финансам — без денежных колонок. */
  async sheet(user: AuthUser, code: string, periodId: number): Promise<EntrySheet> {
    const s = await this.buildSheet(user, code, periodId);
    return this.access.has(user, 'finance') ? s : sheetNoFinance(s);
  }

  private async buildSheet(user: AuthUser, code: string, periodId: number): Promise<EntrySheet> {
    const d = await this.direction(user, code);
    const p = await this.period(d.id, periodId);
    const ed = await this.access.editableSites(user, d.id);
    const allowed = !d.isReadonly && this.statusAllows(ed.role, p.status) && (d.periodKind !== 'REPORT' || p.status === 'OPEN');

    const sites = await this.prisma.site.findMany({
      where: { directionId: d.id, isArchived: false, ...(d.periodKind === 'REPORT' ? this.programScope(p.program, p.id) : {}) },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      include: {
        section: { select: { name: true } },
        assignments: { where: { userId: user.id, role: { in: ['ENTRY', 'CURATOR'] } }, select: { id: true } },
        reports: {
          where: { period: { date: { lte: p.date }, program: p.program } },
          orderBy: { period: { date: 'desc' } },
          take: 1,
          include: { period: { select: { id: true, date: true } } },
        },
        workItems: {
          where: { isArchived: false },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          include: {
            workType: { include: { group: { select: { name: true } } } },
            progress: {
              where: { period: { date: { lte: p.date }, program: p.program } },
              orderBy: { period: { date: 'desc' } },
              take: 1,
              include: { period: { select: { id: true, date: true } }, status: { select: { code: true } }, enteredBy: { select: { fullName: true } } },
            },
          },
        },
      },
    });

    const anyReport = await this.prisma.siteReport.findFirst({
      where: { site: { directionId: d.id } },
      select: { workers: true },
      orderBy: { workers: 'desc' },
    });
    const anyBlocked = await this.prisma.siteReport.count({ where: { site: { directionId: d.id }, workersBlocked: { not: null } } });
    const items = sites.flatMap((s) => s.workItems);

    return {
      direction: { code: d.code, name: d.name, periodKind: d.periodKind },
      period: { id: p.id, date: day(p.date)!, status: p.status, label: p.label, program: p.program },
      ...(d.periodKind === 'REPORT' ? { aggregate: { version: reportSummaryStoredSchema.safeParse(p.summary).data?.version ?? 0,
        value: (() => { const v = reportSummaryStoredSchema.safeParse(p.summary).data?.value; return v ? { ...v, violations: this.access.canSee(user, 'remarks') ? v.violations : [] } : null; })(), canEdit: allowed && (ed.role === 'CURATOR' || ed.role === 'ADMIN') } } : {}),
      permissions: {
        role: ed.role,
        canEdit: allowed && (ed.all || ed.ids.size > 0),
        canClose: !d.isReadonly && p.status === 'OPEN' && (ed.role === 'CURATOR' || ed.role === 'ADMIN'),
        canReopen: !d.isReadonly && ((p.status === 'CLOSED' && (ed.role === 'CURATOR' || ed.role === 'ADMIN')) || (p.status === 'LOCKED' && ed.role === 'ADMIN')),
        canLock: !d.isReadonly && p.status !== 'LOCKED' && ed.role === 'ADMIN',
        canOpenNew: !d.isReadonly && (ed.role === 'CURATOR' || ed.role === 'ADMIN'),
        reason: allowed ? null : (d.periodKind === 'REPORT' && !d.isReadonly && p.status !== 'OPEN' ? 'Исторический отчёт закрыт. Уполномоченный сотрудник должен явно вернуть его в работу.' : this.reasonClosed(ed.role, p.status, d.isReadonly)),
      },
      fields: {
        status: d.statusDefs.length > 0,
        pct: items.some((i) => i.planQty == null),
        factQty: items.some((i) => i.planQty != null),
        ks: d.moneySource === 'WORK_ITEMS',
        paid: d.moneySource === 'WORK_ITEMS',
        workers: d.periodKind === 'REPORT' || (anyReport?.workers ?? null) != null,
        reportStatus: d.periodKind === 'REPORT',
        reportRemarks: d.periodKind === 'REPORT' && this.access.canSee(user, 'remarks'),
        blocked: anyBlocked > 0,
        reportKs: d.moneySource === 'CONTRACTS',
        reportPaid: d.moneySource === 'SITE_LIMIT',
      },
      statuses: d.statusDefs.map((s) => ({ code: s.code, name: s.name, color: s.color, countsAsDone: s.countsAsDone, excludeFromCalc: s.excludeFromCalc })),
      sites: sites.map((s) => {
        const r = s.reports[0];
        const ownReport = r?.periodId === p.id;
        return {
          id: s.id,
          name: s.shortName ?? s.name,
          section: s.section?.name ?? null,
          canEdit: allowed && (ed.all || ed.ids.has(s.id)),
          mine: s.assignments.length > 0,
          updated: ownReport || s.workItems.some((w) => w.progress[0]?.periodId === p.id),
          report: {
            value: {
              workers: r?.workers ?? null,
              machines: r?.machines ?? null,
              workersBlocked: r?.workersBlocked ?? null,
              machinesBlocked: r?.machinesBlocked ?? null,
              ks: num(r?.ksAmount),
              paid: num(r?.paidAmount),
              note: ownReport ? (r?.note ?? null) : null,
              statusText: r?.statusText ?? null,
              remarksCount: this.access.canSee(user, 'remarks') ? r?.remarksCount ?? null : null,
            },
            version: ownReport ? r!.version : null,
            from: r ? day(r.period.date) : null,
          },
          items: s.workItems.map((w) => {
            const e = w.progress[0];
            const own = e?.periodId === p.id;
            return {
              id: w.id,
              name: w.label ?? w.workType.name,
              group: w.workType.group?.name ?? null,
              unit: w.unit,
              planQty: d.periodKind === 'REPORT' ? num(e ? (e.attrs as { p?: number } | null)?.p : w.planQty) : num(w.planQty),
              planCost: num(w.planCost),
              planStart: day(w.planStart),
              planEnd: day(w.planEnd),
              value: {
                statusCode: e?.status?.code ?? null,
                pct: num(e?.pct),
                factQty: num(e?.factQty),
                ks: num(e?.ksAmount),
                paid: num(e?.paidAmount),
                note: own ? (e?.note ?? null) : null,
              },
              version: own ? e!.version : null,
              from: e ? day(e.period.date) : null,
              enteredBy: e?.enteredBy?.fullName ?? null,
              enteredAt: e ? e.updatedAt.toISOString() : null,
            };
          }),
        };
      }),
    };
  }

  async save(user: AuthUser, code: string, periodId: number, body: EntrySaveData, ip: string | null): Promise<EntrySaveResult> {
    const d = await this.direction(user, code);
    if (d.isReadonly) throw new ForbiddenException('Данные направления приходят отчётами — ручной ввод не предусмотрен');
    const p = await this.period(d.id, periodId);
    if (d.periodKind === 'REPORT' && p.status !== 'OPEN') throw new ForbiddenException('Исторический отчёт необходимо явно вернуть в работу');
    const ed = await this.access.editableSites(user, d.id);
    if (!this.statusAllows(ed.role, p.status)) throw new ForbiddenException(this.reasonClosed(ed.role, p.status, false) ?? 'Нет прав');
    const programSites = d.periodKind === 'REPORT' ? new Set((await this.prisma.site.findMany({ where: { directionId: d.id, ...this.programScope(p.program, p.id) }, select: { id: true } })).map(s => s.id)) : null;
    const canSite = (siteId: number) => (ed.all || ed.ids.has(siteId)) && (!programSites || programSites.has(siteId));
    const status = new Map(d.statusDefs.map((s) => [s.code, s.id]));
    // без доступа к финансам денежные значения не принимаются — остаются прежними
    if (!this.access.has(user, 'finance')) {
      body = { items: body.items.map(({ ks: _k, paid: _p, ...i }) => i), reports: body.reports.map(({ ks: _k, paid: _p, ...r }) => r) };
    }
    const dateLabel = day(p.date)!.split('-').reverse().join('.');
    if (!this.access.canSee(user, 'remarks')) body = { ...body, reports: body.reports.map(({ remarksCount: _r, ...r }) => r) };

    const itemIds = body.items.map((i) => i.workItemId);
    const siteIds = body.reports.map((r) => r.siteId);
    if (new Set(itemIds).size !== itemIds.length || new Set(siteIds).size !== siteIds.length) {
      throw new BadRequestException('Одна позиция или объект указаны дважды');
    }
    const [items, sites] = await Promise.all([
      this.prisma.workItem.findMany({
        where: { id: { in: itemIds } },
        include: { site: { select: { id: true, directionId: true, isArchived: true, shortName: true, name: true } }, workType: { select: { name: true } }, progress: { where: { period: { program: p.program, date: { lte: p.date } } }, orderBy: { period: { date: 'desc' } }, take: 1 } },
      }),
      this.prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, directionId: true, isArchived: true, shortName: true, name: true } }),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const siteById = new Map(sites.map((s) => [s.id, s]));
    for (const i of body.items) {
      const it = itemById.get(i.workItemId);
      if (!it || it.site.directionId !== d.id || it.isArchived || it.site.isArchived) throw new BadRequestException(`Позиция ${i.workItemId} не относится к направлению`);
      if (!canSite(it.siteId)) throw new ForbiddenException(`Нет прав на ввод по объекту «${it.site.shortName ?? it.site.name}»`);
      if (i.statusCode != null && !status.has(i.statusCode)) throw new BadRequestException(`Неизвестный статус «${i.statusCode}»`);
    }
    for (const r of body.reports) {
      const s = siteById.get(r.siteId);
      if (!s || s.directionId !== d.id || s.isArchived) throw new BadRequestException(`Объект ${r.siteId} не относится к направлению`);
      if (!canSite(s.id)) throw new ForbiddenException(`Нет прав на ввод по объекту «${s.shortName ?? s.name}»`);
    }

    const [existingItems, existingReports] = await Promise.all([
      this.prisma.progressEntry.findMany({ where: { periodId, workItemId: { in: itemIds } }, include: { status: { select: { code: true } } } }),
      this.prisma.siteReport.findMany({ where: { periodId, siteId: { in: siteIds } } }),
    ]);
    const exItem = new Map(existingItems.map((e) => [e.workItemId, e]));
    const exReport = new Map(existingReports.map((e) => [e.siteId, e]));

    // одновременная правка: версия, которую видел пользователь, должна совпасть с текущей
    const conflicts: string[] = [];
    for (const i of body.items) {
      const e = exItem.get(i.workItemId);
      if ((e?.version ?? undefined) !== i.version) {
        const it = itemById.get(i.workItemId)!;
        conflicts.push(`${it.site.shortName ?? it.site.name} · ${it.label ?? it.workType.name}`);
      }
    }
    for (const r of body.reports) {
      const e = exReport.get(r.siteId);
      if ((e?.version ?? undefined) !== r.version) conflicts.push(`${siteById.get(r.siteId)!.shortName ?? ''} · показатели объекта`);
    }
    if (conflicts.length) {
      throw new ConflictException({
        message: 'Пока вы вносили данные, их изменил другой пользователь. Обновите лист ввода и внесите правки заново.',
        conflicts,
      });
    }

    let savedItems = 0, savedReports = 0, unchanged = 0;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM reporting_period WHERE id = ${periodId} FOR UPDATE`;
        const livePeriod = await tx.reportingPeriod.findUniqueOrThrow({ where: { id: periodId } });
        if ((await tx.direction.findUniqueOrThrow({ where: { id: d.id }, select: { isReadonly: true } })).isReadonly) throw new ForbiddenException('Ручной ввод направления отключён');
        if (!this.statusAllows(ed.role, livePeriod.status) || (d.periodKind === 'REPORT' && livePeriod.status !== 'OPEN')) throw new ForbiddenException('Отчётная точка закрыта — обновите лист ввода');
        for (const i of body.items) {
          const it = itemById.get(i.workItemId)!;
          const e = exItem.get(i.workItemId);
          const before: EntryValue | null = e
            ? { statusCode: e.status?.code ?? null, pct: num(e.pct), factQty: num(e.factQty), ks: num(e.ksAmount), paid: num(e.paidAmount), note: e.note }
            : null;
          const after: EntryValue = {
            statusCode: i.statusCode !== undefined ? i.statusCode : (before?.statusCode ?? null),
            pct: i.pct !== undefined ? i.pct : (before?.pct ?? null),
            factQty: i.factQty !== undefined ? i.factQty : (before?.factQty ?? null),
            ks: i.ks !== undefined ? i.ks : (before?.ks ?? null),
            paid: i.paid !== undefined ? i.paid : (before?.paid ?? null),
            note: i.note !== undefined ? i.note || null : (before?.note ?? null),
          };
          if (before && ITEM_FIELDS.every((f) => before[f] === after[f])) {
            unchanged++;
            continue;
          }
          const origin = e ?? it.progress[0];
          const data = {
            // Отсутствующий p в существующем отчёте — неизвестный объём, а не глобальный план другого среза.
            ...(d.periodKind === 'REPORT' ? { attrs: { ...((origin?.attrs ?? {}) as Record<string, Prisma.InputJsonValue>), p: num(origin ? (origin.attrs as { p?: number } | null)?.p : it.planQty) } as Prisma.InputJsonValue } : {}),
            statusId: after.statusCode ? status.get(after.statusCode)! : null,
            pct: after.pct,
            factQty: after.factQty,
            ksAmount: after.ks,
            paidAmount: after.paid,
            note: after.note,
            source: 'MANUAL' as const,
            isExample: false,
            updatedById: user.id,
          };
          if (e && !(await tx.progressEntry.updateMany({ where: { id: e.id, version: e.version }, data: { ...data, version: { increment: 1 } } })).count) throw new ConflictException('Данные уже изменены — обновите лист ввода');
          const row = e ? await tx.progressEntry.findUniqueOrThrow({ where: { id: e.id } }) : await tx.progressEntry.create({ data: { ...data, workItemId: it.id, periodId, enteredById: user.id } });
          await this.audit.write(
            {
              userId: user.id,
              action: e ? 'UPDATE' : 'CREATE',
              entity: 'progress_entry',
              entityId: row.id,
              directionId: d.id,
              siteId: it.siteId,
              before: before ? { ...before, source: e!.source, attrs: e!.attrs, program: p.program, date: day(p.date), sheet: p.label } : null,
              after: { ...after, source: row.source, attrs: row.attrs, program: p.program, date: day(p.date), sheet: p.label },
              comment: `${it.label ?? it.workType.name} · ${dateLabel}`,
              ip,
            },
            tx,
          );
          savedItems++;
        }

        for (const r of body.reports) {
          const e = exReport.get(r.siteId);
          const before: EntryReportValue | null = e
            ? {
                workers: e.workers, machines: e.machines, workersBlocked: e.workersBlocked, machinesBlocked: e.machinesBlocked,
                ks: num(e.ksAmount), paid: num(e.paidAmount), note: e.note,
                statusText: e.statusText, remarksCount: e.remarksCount,
              }
            : null;
          const pick = <K extends keyof EntryReportValue>(k: K) => (r[k] !== undefined ? (r[k] as EntryReportValue[K]) : (before?.[k] ?? null));
          const after: EntryReportValue = {
            workers: pick('workers'), machines: pick('machines'), workersBlocked: pick('workersBlocked'), machinesBlocked: pick('machinesBlocked'),
            ks: pick('ks'), paid: pick('paid'), note: (pick('note') as string | null) || null,
            statusText: r.statusText !== undefined ? r.statusText : e?.statusText ?? null,
            remarksCount: r.remarksCount !== undefined ? r.remarksCount : e?.remarksCount ?? null,
          };
          if (before && REPORT_FIELDS.every((f) => before[f] === after[f])) {
            unchanged++;
            continue;
          }
          const data = {
            statusText: after.statusText, remarksCount: after.remarksCount,
            workers: after.workers, machines: after.machines, workersBlocked: after.workersBlocked, machinesBlocked: after.machinesBlocked,
            ksAmount: after.ks, paidAmount: after.paid, note: after.note, source: 'MANUAL' as const, isExample: false, updatedById: user.id,
          };
          if (e && !(await tx.siteReport.updateMany({ where: { id: e.id, version: e.version }, data: { ...data, version: { increment: 1 } } })).count) throw new ConflictException('Данные уже изменены — обновите лист ввода');
          const row = e ? await tx.siteReport.findUniqueOrThrow({ where: { id: e.id } }) : await tx.siteReport.create({ data: { ...data, siteId: r.siteId, periodId, enteredById: user.id } });
          await this.audit.write(
            {
              userId: user.id, action: e ? 'UPDATE' : 'CREATE', entity: 'site_report', entityId: row.id,
              directionId: d.id, siteId: r.siteId, before: before ? { ...before, source: e!.source, attrs: e!.attrs, program: p.program, date: day(p.date), sheet: p.label } : null, after: { ...after, source: row.source, attrs: row.attrs, program: p.program, date: day(p.date), sheet: p.label }, comment: `показатели объекта · ${dateLabel}`, ip,
            },
            tx,
          );
          savedReports++;
        }
      },
      { timeout: 60_000 },
    ).catch((e) => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Данные уже созданы другим сотрудником — обновите лист'); throw e; });

    this.kpi.invalidate(d.id);
    return { savedItems, savedReports, unchanged };
  }

  /** Открыть новую отчётную точку (неделя — с понедельника). Куратор или администратор. */
  async saveSummary(user: AuthUser, code: string, periodId: number, body: ReportSummarySave, ip: string | null) {
    const d = await this.direction(user, code);
    if (d.periodKind !== 'REPORT' || d.isReadonly || !(await this.access.canManageDirection(user, d.id))) throw new ForbiddenException('Сводку отчёта заполняет куратор доступного для ввода направления');
    await this.period(d.id, periodId);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM reporting_period WHERE id = ${periodId} FOR UPDATE`;
      const p = await tx.reportingPeriod.findUniqueOrThrow({ where: { id: periodId } });
      if (p.status !== 'OPEN') throw new ForbiddenException('Сначала явно верните отчёт в работу');
      const before = reportSummaryStoredSchema.safeParse(p.summary).data;
      if ((before?.version ?? 0) !== body.version) throw new ConflictException('Сводка уже изменена — обновите отчёт');
      const value = this.access.canSee(user, 'remarks') ? body.value : { ...body.value, violations: before?.value.violations ?? [] };
      const after = { version: body.version + 1, value };
      await tx.reportingPeriod.update({ where: { id: periodId }, data: { summary: after } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'reporting_period', entityId: periodId, directionId: d.id, before, after, comment: `сводка источника · ${p.program} · ${day(p.date)}`, ip }, tx);
    });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  /** Открыть новую отчётную точку (неделя — с понедельника). Куратор или администратор. */
  async openPeriod(user: AuthUser, code: string, dateStr: string, ip: string | null, requestedProgram?: string) {
    const d = await this.direction(user, code);
    if (d.isReadonly) throw new ForbiddenException('Отчётные точки направления создаются загрузкой отчётов');
    if (!(await this.access.canManageDirection(user, d.id))) throw new ForbiddenException('Открывать отчётные точки может куратор направления');
    let date = parse(dateStr);
    if (Number.isNaN(date.getTime()) || day(date) !== dateStr) throw new BadRequestException('Неверная дата');
    const program = d.periodKind === 'REPORT' ? (requestedProgram ?? '') : '';
    if (d.periodKind === 'REPORT') {
      const settings = (d.settings ?? {}) as { programs?: Record<string, string> };
      const known = new Set([...Object.keys(settings.programs ?? {}), ...(await this.prisma.reportingPeriod.findMany({ where: { directionId: d.id }, distinct: ['program'], select: { program: true } })).map(p => p.program)]);
      if (!program || !known.has(program)) throw new BadRequestException('Выберите существующую программу отчёта');
    }
    if (d.periodKind === 'WEEK') {
      const wd = (date.getUTCDay() + 6) % 7; // 0 = понедельник
      date = new Date(date.getTime() - wd * 86_400_000);
    }
    const exists = await this.prisma.reportingPeriod.findFirst({ where: { directionId: d.id, program, date } });
    if (exists) throw new ConflictException(`Отчётная точка ${day(date)!.split('-').reverse().join('.')} уже есть`);
    const p = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reportingPeriod.create({ data: { directionId: d.id, date, program, status: 'OPEN', openedById: user.id } });
      await this.audit.write(
        { userId: user.id, action: 'PERIOD_OPEN', entity: 'reporting_period', entityId: created.id, directionId: d.id, comment: `открыта точка ${day(date)}`, ip },
        tx,
      );
      return created;
    });
    this.kpi.invalidate(d.id);
    return { id: p.id, date: day(p.date)!, status: p.status };
  }

  /** Закрыть (куратор), вернуть в работу (куратор; из блокировки — администратор), заблокировать (администратор). */
  async setPeriodStatus(user: AuthUser, code: string, periodId: number, status: PeriodStatus, comment: string | undefined, ip: string | null) {
    const d = await this.direction(user, code);
    const p = await this.period(d.id, periodId);
    const role = (await this.access.editableSites(user, d.id)).role;
    const curator = role === 'CURATOR' || role === 'ADMIN';
    const ok =
      status === 'LOCKED' || p.status === 'LOCKED' ? role === 'ADMIN' : status === 'CLOSED' || status === 'OPEN' ? curator : false;
    if (!ok) throw new ForbiddenException(status === 'LOCKED' || p.status === 'LOCKED' ? 'Блокировка — только у администратора' : 'Нужны права куратора направления');
    if (p.status === status) return { id: p.id, status };
    await this.prisma.$transaction(async (tx) => {
      await tx.reportingPeriod.update({
        where: { id: p.id },
        data: status === 'OPEN' ? { status, closedById: null, closedAt: null } : { status, closedById: user.id, closedAt: new Date() },
      });
      await this.audit.write(
        {
          userId: user.id,
          action: status === 'OPEN' ? 'PERIOD_OPEN' : 'PERIOD_CLOSE',
          entity: 'reporting_period',
          entityId: p.id,
          directionId: d.id,
          before: { status: p.status },
          after: { status },
          comment: [`точка ${day(p.date)}`, comment].filter(Boolean).join(' · '),
          ip,
        },
        tx,
      );
    });
    this.kpi.invalidate(d.id);
    return { id: p.id, status };
  }

  /** Журнал изменений направления: кто, когда, что было → что стало. */
  async auditLog(
    user: AuthUser,
    code: string,
    q: { userId?: number; siteId?: number; from?: string; to?: string; skip?: number; take?: number },
  ): Promise<AuditPage> {
    this.access.assertFeature(user, 'audit');
    const d = await this.direction(user, code);
    const where: Prisma.AuditLogWhereInput = {
      directionId: d.id,
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.siteId ? { siteId: q.siteId } : {}),
      ...(q.from || q.to ? { at: { ...(q.from ? { gte: parse(q.from) } : {}), ...(q.to ? { lt: new Date(parse(q.to).getTime() + 86_400_000) } : {}) } } : {}),
    };
    const take = Math.min(200, Math.max(1, q.take ?? 50));
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip ?? 0, take, include: { user: { select: { fullName: true } } } }),
    ]);
    const siteIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is number => x != null))];
    const sites = new Map(
      (await this.prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, shortName: true, name: true } })).map((s) => [s.id, s.shortName ?? s.name]),
    );
    // коды → понятные названия: статусы позиций направления и статусы отчётной точки
    const statusName = new Map(d.statusDefs.map((s) => [s.code, s.name]));
    const PERIOD: Record<string, string> = { OPEN: 'открыта', CLOSED: 'закрыта куратором', LOCKED: 'заблокирована' };
    const human = (k: string, v: unknown) =>
      v == null ? null : k === 'statusCode' ? (statusName.get(String(v)) ?? v) : k === 'status' ? (PERIOD[String(v)] ?? v) : v;
    return {
      total,
      rows: rows.map((r) => {
        const b = (r.before ?? {}) as Record<string, unknown>;
        const a = (r.after ?? {}) as Record<string, unknown>;
        const created = r.before == null;
        const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
          .filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null))
          // у новой записи пустые поля не показываем
          .filter((k) => !created || a[k] != null);
        return {
          id: r.id.toString(),
          at: r.at.toISOString(),
          user: r.user?.fullName ?? null,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          site: r.siteId ? (sites.get(r.siteId) ?? null) : null,
          comment: r.comment,
          changes: keys.map((k) => ({ field: FIELD_LABEL[k] ?? k, before: human(k, b[k]), after: human(k, a[k]) })),
        };
      }),
    };
  }
}
