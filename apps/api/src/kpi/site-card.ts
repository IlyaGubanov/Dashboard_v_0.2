/** Карточка объекта: паспорт, доп. поля направления, позиции с фактом и планом, договоры, надстройки, история. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SiteCard, SiteCardTracker } from '@mvs/shared';
import { calcSite, planDateFor, siteForecast, siteHistory, toRow } from './engine';
import { basePeriod } from './forecast';
import { isoDate, type KDirection, type KPeriod, type KSite } from './model';

const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
type Options = { value: string; label: string; color?: string; done?: boolean }[] | null;

export async function buildSiteCard(db: PrismaClient, dir: KDirection, ks: KSite, period: KPeriod | null, own: KPeriod[]): Promise<SiteCard> {
  const s = await db.site.findUniqueOrThrow({
    where: { id: ks.id },
    include: {
      contractor: { select: { name: true } },
      designer: { select: { name: true } },
      assignments: { include: { user: { select: { fullName: true, position: true, phone: true, email: true } } } },
      contracts: { include: { organization: { select: { name: true } } }, orderBy: { signedAt: 'asc' } },
      workItems: {
        where: { isArchived: false },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        include: {
          workType: { include: { group: { select: { name: true } } } },
          responsible: { select: { fullName: true } },
          contractor: { select: { name: true } },
        },
      },
      trackerRows: { include: { item: true, values: { include: { stage: true } } } },
    },
  });
  const [fieldDefs, trackers, statusRows] = await Promise.all([
    db.fieldDef.findMany({ where: { directionId: dir.id, entity: 'SITE', isArchived: false }, orderBy: { sort: 'asc' } }),
    db.tracker.findMany({ where: { directionId: dir.id, isActive: true }, orderBy: { sort: 'asc' }, include: { stages: { orderBy: { sort: 'asc' } } } }),
    db.statusDef.findMany({ where: { directionId: dir.id, entity: 'WORK_ITEM' } }),
  ]);
  const statuses = new Map(statusRows.map((r) => [r.code, { code: r.code, name: r.name, color: r.color }]));

  // без отчётных точек (новое направление) — считаем «на сегодня»: факта нет, план по датам
  const at: KPeriod = period ?? { id: -1, date: Date.now(), status: 'OPEN', program: '', label: null };
  const calc = calcSite(dir, ks, at, planDateFor(dir, at));
  if (period) {
    const bp = basePeriod(dir, period);
    calc.forecast = siteForecast(dir, period, calc, bp ? { period: bp, calc: calcSite(dir, ks, bp, planDateFor(dir, bp)) } : null);
  }
  const byItem = new Map(calc.items.map((i) => [i.item.id, i]));
  const enteredIds = [...new Set(calc.items.map((i) => i.entry?.enteredById).filter((x): x is number => x != null))];
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: enteredIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );
  const attrs = (s.attrs ?? {}) as Record<string, unknown>;

  const trackerOut: SiteCardTracker[] = trackers.map((t) => ({
    code: t.code,
    name: t.name,
    layout: t.layout,
    stages: t.stages.map((st) => ({ code: st.code, name: st.name, valueType: st.valueType, options: st.options as Options })),
    rows: s.trackerRows
      .filter((r) => r.item.trackerId === t.id)
      .sort((a, b) => a.item.sort - b.item.sort)
      .map((r) => ({
        item: { code: r.item.code, name: r.item.name, category: r.item.category },
        qty: num(r.qty),
        unit: r.unit,
        planDate: day(r.planDate),
        dueDate: day(r.dueDate),
        attrs: (r.attrs ?? null) as Record<string, unknown> | null,
        values: Object.fromEntries(
          r.values.map((v) => [v.stage.code, v.valueText ?? (v.valueNum != null ? Number(v.valueNum) : v.valueBool ?? day(v.valueDate))]),
        ),
      })),
  }));

  return {
    row: toRow(calc),
    address: s.address,
    okrug: s.okrug,
    district: s.district,
    note: s.note,
    contractor: s.contractor?.name ?? null,
    designer: s.designer?.name ?? null,
    limit: num(s.limitAmount),
    asOf: period ? isoDate(period.date) : null,
    fields: fieldDefs
      .filter((f) => attrs[f.code] !== undefined)
      .map((f) => ({
        code: f.code,
        label: f.label,
        type: f.type,
        unit: f.unit,
        group: f.groupName,
        value: attrs[f.code],
        options: f.options as Options,
      })),
    assignments: s.assignments.map((a) => ({ role: a.role, ...a.user })),
    items: s.workItems.map((w) => {
      const c = byItem.get(w.id);
      const e = c?.entry ?? null;
      return {
        id: w.id,
        code: w.code,
        name: w.label ?? w.workType.name,
        group: w.workType.group?.name ?? null,
        unit: w.unit,
        planQty: num(w.planQty),
        planCost: num(w.planCost),
        planStart: day(w.planStart),
        planEnd: day(w.planEnd),
        weight: num(w.workType.weight),
        responsible: w.responsible?.fullName ?? null,
        contractor: w.contractor?.name ?? null,
        fact: c?.fact ?? 0,
        factQty: e?.factQty ?? null,
        plan: c?.plan ?? null,
        excluded: !!c?.excluded,
        overdue: !!c?.overdue,
        status: e?.statusCode ? (statuses.get(e.statusCode) ?? null) : null,
        ks: e?.ks ?? null,
        paid: e?.paid ?? null,
        enteredAt: e?.enteredAt ? new Date(e.enteredAt).toISOString() : null,
        enteredBy: e?.enteredById ? (users.get(e.enteredById) ?? null) : null,
        asOf: e ? isoDate(e.date) : null,
        isExample: w.isExample || !!e?.isExample,
      };
    }),
    contracts: s.contracts.map((c) => ({
      number: c.number,
      signedAt: day(c.signedAt),
      endAt: day(c.endAt),
      amount: num(c.amount),
      advance: num(c.advanceAmount),
      organization: c.organization?.name ?? null,
    })),
    history: siteHistory(dir, ks, own),
    trackers: trackerOut.filter((t) => t.rows.length),
    canEdit: false,
    canManage: false,
  };
}

