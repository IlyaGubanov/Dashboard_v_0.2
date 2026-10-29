/** Представления направления: сетка работ (матрица, график), надстройки по всем объектам, ответственные. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PeopleView, TrackersView, WorkGrid } from '@mvs/shared';
import { calcSite, planDateFor } from './engine';
import { isoDate, type KDirection, type KPeriod } from './model';

const day = (ms: number | null) => (ms == null ? null : isoDate(ms));
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));

export async function workGrid(db: PrismaClient, dir: KDirection, period: KPeriod | null): Promise<WorkGrid> {
  const [types, labels] = await Promise.all([
    db.workType.findMany({ where: { directionId: dir.id, isArchived: false }, orderBy: { sort: 'asc' }, include: { group: true } }),
    db.workItem.findMany({ where: { site: { directionId: dir.id } }, select: { id: true, label: true } }),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const label = new Map(labels.map((l) => [l.id, l.label]));
  const at: KPeriod = period ?? { id: -1, date: Date.now(), status: 'OPEN', program: '', label: null };
  const P = planDateFor(dir, at);
  const used = new Set<number>();

  const sites = dir.sites.map((s) => {
    const c = calcSite(dir, s, at, P);
    const starts = s.items.map((i) => i.planStart).filter((x): x is number => x != null);
    const ends = s.items.map((i) => i.planEnd).filter((x): x is number => x != null);
    for (const i of s.items) used.add(i.workTypeId);
    return {
      id: s.id,
      name: s.shortName,
      section: s.section?.name ?? null,
      risk: c.risk,
      fact: c.fact,
      plan: c.plan,
      start: day(s.planStart ?? (starts.length ? Math.min(...starts) : null)),
      end: day(s.planEnd ?? (ends.length ? Math.max(...ends) : null)),
      items: c.items.map((i) => ({
        id: i.item.id,
        workTypeId: i.item.workTypeId,
        name: label.get(i.item.id) ?? typeName.get(i.item.workTypeId) ?? '—',
        start: day(i.item.planStart),
        end: day(i.item.planEnd),
        fact: i.fact,
        plan: i.plan,
        excluded: i.excluded,
        overdue: i.overdue,
        status: i.entry?.statusCode ?? null,
        factQty: i.entry?.factQty ?? null,
        planQty: i.entry?.p ?? i.item.planQty,
        unit: i.item.unit,
      })),
    };
  });

  return {
    asOf: period ? isoDate(period.date) : null,
    planDate: dir.planMethod === 'NONE' ? null : isoDate(P),
    workTypes: types
      .filter((t) => used.has(t.id))
      .map((t) => ({ id: t.id, code: t.code, name: t.name, group: t.group?.name ?? null, unit: t.unit })),
    sites,
  };
}

export async function trackersView(db: PrismaClient, directionId: number): Promise<TrackersView> {
  const trackers = await db.tracker.findMany({
    where: { directionId, isActive: true },
    orderBy: { sort: 'asc' },
    include: {
      stages: { orderBy: { sort: 'asc' } },
      items: {
        where: { isArchived: false },
        orderBy: { sort: 'asc' },
        include: { rows: { include: { site: { select: { id: true, shortName: true, name: true, isArchived: true } }, values: { include: { stage: true } } } } },
      },
    },
  });
  type Opt = { value: string; label: string; color?: string; done?: boolean }[] | null;
  return {
    trackers: trackers.map((t) => ({
      code: t.code,
      name: t.name,
      layout: t.layout,
      stages: t.stages.map((s) => ({ code: s.code, name: s.name, valueType: s.valueType, options: s.options as Opt })),
      items: t.items.map((i) => ({ code: i.code, name: i.name, category: i.category })),
      rows: t.items.flatMap((i) =>
        i.rows
          .filter((r) => !r.site.isArchived)
          .map((r) => ({
            siteId: r.site.id,
            siteName: r.site.shortName ?? r.site.name,
            item: { code: i.code, name: i.name, category: i.category },
            qty: num(r.qty),
            unit: r.unit,
            planDate: r.planDate ? isoDate(r.planDate.getTime()) : null,
            dueDate: r.dueDate ? isoDate(r.dueDate.getTime()) : null,
            attrs: (r.attrs ?? null) as Record<string, unknown> | null,
            values: Object.fromEntries(
              r.values.map((v) => [
                v.stage.code,
                v.valueText ?? (v.valueNum != null ? Number(v.valueNum) : (v.valueBool ?? (v.valueDate ? isoDate(v.valueDate.getTime()) : null))),
              ]),
            ),
          })),
      ),
    })),
  };
}

/** Кто отвечает за направление и кто когда вносил данные (контроль заполнения). */
export async function peopleView(db: PrismaClient, directionId: number, periods: KPeriod[]): Promise<PeopleView> {
  const current = periods.at(-1) ?? null;
  const [members, assignments, responsible, entries, currentEntries, reports] = await Promise.all([
    db.directionMember.findMany({ where: { directionId }, include: { user: true, sections: { include: { section: true } } } }),
    db.siteAssignment.groupBy({ by: ['userId', 'role'], where: { site: { directionId, isArchived: false } }, _count: { _all: true } }),
    db.workItem.groupBy({ by: ['responsibleId'], where: { site: { directionId }, isArchived: false, responsibleId: { not: null } }, _count: { _all: true } }),
    db.progressEntry.groupBy({
      by: ['enteredById'],
      where: { workItem: { site: { directionId } }, enteredById: { not: null } },
      _count: { _all: true },
      _max: { enteredAt: true },
    }),
    current
      ? db.progressEntry.groupBy({ by: ['enteredById'], where: { periodId: current.id, enteredById: { not: null } }, _count: { _all: true } })
      : Promise.resolve([]),
    db.siteReport.groupBy({
      by: ['enteredById'],
      where: { site: { directionId }, enteredById: { not: null } },
      _count: { _all: true },
      _max: { enteredAt: true },
    }),
  ]);

  // все, кто как-то связан с направлением: роль, назначение на объект, позиции, ввод
  const ids = new Set<number>([
    ...members.map((m) => m.userId),
    ...assignments.map((a) => a.userId),
    ...responsible.map((r) => r.responsibleId!),
    ...entries.map((e) => e.enteredById!),
  ]);
  const users = await db.user.findMany({ where: { id: { in: [...ids] } } });
  const member = new Map(members.map((m) => [m.userId, m]));
  const max = (...d: (Date | null | undefined)[]) => d.filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const people = users.map((u) => {
    const m = member.get(u.id);
    const e = entries.find((x) => x.enteredById === u.id);
    const r = reports.find((x) => x.enteredById === u.id);
    const last = max(e?._max.enteredAt, r?._max.enteredAt);
    return {
      userId: u.id,
      fullName: u.fullName,
      position: u.position,
      phone: u.phone,
      email: u.email,
      canLogin: u.canLogin,
      role: m?.role ?? null,
      scope: m?.scope ?? null,
      sections: m?.sections.map((s) => s.section.name) ?? [],
      assignments: Object.fromEntries(assignments.filter((a) => a.userId === u.id).map((a) => [a.role, a._count._all])),
      responsibleItems: responsible.find((x) => x.responsibleId === u.id)?._count._all ?? 0,
      entries: (e?._count._all ?? 0) + (r?._count._all ?? 0),
      lastEntryAt: last ? last.toISOString() : null,
      enteredCurrent: (currentEntries as { enteredById: number | null }[]).some((x) => x.enteredById === u.id),
    };
  });
  const order = { CURATOR: 0, EDITOR: 1, VIEWER: 2 } as Record<string, number>;
  people.sort((a, b) => (order[a.role ?? ''] ?? 3) - (order[b.role ?? ''] ?? 3) || a.fullName.localeCompare(b.fullName, 'ru'));
  return { currentPeriod: current ? { date: isoDate(current.date), status: current.status } : null, people };
}
