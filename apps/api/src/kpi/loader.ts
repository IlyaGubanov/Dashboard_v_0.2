/** Загрузка направления из БД в модель расчёта. Без декораторов — используется и сервисом, и тестами. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { parseDate, toMs, type KDirection, type KPeriod, type KpiTileConfig } from './model';

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

type Db = Pick<PrismaClient, 'direction' | 'reportingPeriod' | 'site' | 'tracker'>;

/** Отчётные точки направления по возрастанию даты. */
export async function loadPeriods(db: Db, directionId: number): Promise<KPeriod[]> {
  const rows = await db.reportingPeriod.findMany({ where: { directionId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
  return rows.map((p) => ({ id: p.id, date: p.date.getTime(), status: p.status, program: p.program, label: p.label }));
}

/**
 * Направление с объектами, позициями, фактом и отчётами объектов.
 * periodIds — какие отчётные точки нужны (для недель и дней — все до даты среза, для отчётов — нужные листы).
 */
export async function loadDirection(db: Db, directionId: number, periods: KPeriod[], periodIds: number[]): Promise<KDirection> {
  const d = await db.direction.findUniqueOrThrow({ where: { id: directionId }, include: { workTypes: true, statusDefs: true } });
  const date = new Map(periods.map((p) => [p.id, p.date]));
  const weight = new Map(d.workTypes.map((w) => [w.id, num(w.weight)]));
  const ids = { in: periodIds };

  const sites = await db.site.findMany({
    where: { directionId, isArchived: false },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: {
      section: { select: { id: true, name: true } },
      status: { select: { code: true, name: true, color: true } },
      contracts: { select: { amount: true, advanceAmount: true } },
      assignments: { include: { user: { select: { fullName: true } } } },
      reports: { where: { periodId: ids } },
      remarks: { select: { createdAt: true, resolvedAt: true, dueDate: true, status: true } },
      workItems: {
        where: { isArchived: false },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        include: { progress: { where: { periodId: ids }, include: { status: true } } },
      },
    },
  });

  const trackers = await db.tracker.findMany({
    where: { directionId, isActive: true },
    include: { stages: true, items: { include: { rows: { include: { values: true } } } } },
  });

  const settings = (d.settings ?? {}) as KDirection['settings'];
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    shortName: d.shortName,
    isReadonly: d.isReadonly,
    periodKind: d.periodKind,
    planWeekday: d.planWeekday,
    progressMethod: d.progressMethod,
    planMethod: d.planMethod,
    moneySource: d.moneySource,
    moneyLabel: d.moneyLabel,
    thrWarn: Number(d.thrWarn),
    thrCrit: Number(d.thrCrit),
    siteUnit: d.siteUnit,
    settings: { ...settings, kpis: (settings.kpis ?? []) as KpiTileConfig[] },
    periods,
    trackers: trackers.map((t) => {
      const stageCode = new Map(t.stages.map((s) => [s.id, s.code]));
      return {
        code: t.code,
        stages: t.stages.map((s) => ({ code: s.code, options: (s.options ?? []) as { value: string; done?: boolean }[] })),
        rows: t.items.flatMap((it) =>
          it.rows.map((r) => ({
            siteId: r.siteId,
            planDate: toMs(r.planDate),
            dueDate: toMs(r.dueDate),
            values: Object.fromEntries(
              r.values.map((v) => [
                stageCode.get(v.stageId)!,
                { num: num(v.valueNum), text: v.valueText, bool: v.valueBool, date: toMs(v.valueDate) },
              ]),
            ),
          })),
        ),
      };
    }),
    sites: sites.map((s) => ({
      id: s.id,
      code: s.code,
      num: s.num,
      name: s.name,
      shortName: s.shortName ?? s.name,
      section: s.section,
      status: s.status,
      planStart: toMs(s.planStart),
      planEnd: toMs(s.planEnd),
      limit: num(s.limitAmount),
      contracts: s.contracts.map((c) => ({ amount: num(c.amount), advance: num(c.advanceAmount) })),
      curators: s.assignments.filter((a) => a.role === 'CURATOR' || a.role === 'RESPONSIBLE').map((a) => a.user.fullName),
      entry: s.assignments.filter((a) => a.role === 'ENTRY').map((a) => a.user.fullName),
      lat: num(s.lat),
      lon: num(s.lon),
      isExample: s.isExample,
      remarkLog: s.remarks.map((r) => ({
        created: r.createdAt.getTime(),
        // закрытое без даты закрытия (старые данные) считаем закрытым с момента создания
        closed: r.resolvedAt ? r.resolvedAt.getTime() : r.status === 'VERIFIED' || r.status === 'REJECTED' ? r.createdAt.getTime() : null,
        due: toMs(r.dueDate),
      })),
      reports: s.reports
        .map((r) => ({
          periodId: r.periodId,
          date: date.get(r.periodId)!,
          workers: r.workers,
          workersBlocked: r.workersBlocked,
          machines: r.machines,
          machinesBlocked: r.machinesBlocked,
          ks: num(r.ksAmount),
          advance: num(r.advanceAmount),
          paid: num(r.paidAmount),
          statusText: r.statusText,
          remarks: r.remarksCount,
        }))
        .sort((a, b) => a.date - b.date),
      items: s.workItems.map((it) => ({
        id: it.id,
        workTypeId: it.workTypeId,
        unit: it.unit,
        planQty: num(it.planQty),
        planCost: num(it.planCost),
        planStart: toMs(it.planStart),
        planEnd: toMs(it.planEnd),
        weight: weight.get(it.workTypeId) ?? null,
        isExample: it.isExample,
        entries: it.progress
          .map((e) => ({
            periodId: e.periodId,
            date: date.get(e.periodId)!,
            statusCode: e.status?.code ?? null,
            countsAsDone: !!e.status?.countsAsDone,
            exclude: !!e.status?.excludeFromCalc,
            pct: num(e.pct),
            factQty: num(e.factQty),
            ks: num(e.ksAmount),
            paid: num(e.paidAmount),
            p: num((e.attrs as { p?: number } | null)?.p ?? null),
            isExample: e.isExample,
            enteredById: e.enteredById,
            enteredAt: e.enteredAt.getTime(),
          }))
          .sort((a, b) => a.date - b.date),
      })),
    })),
  };
}

export { parseDate };
