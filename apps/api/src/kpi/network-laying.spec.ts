/** Прокладка сетей: физические объёмы на срез, без исключённых позиций и других работ. БД не нужна. */
import { describe, expect, it } from 'vitest';
import { directionKpi } from './engine';
import { parseDate, type KDirection, type KEntry, type KItem, type KSite } from './model';

const periods = [
  { id: 1, date: parseDate('2026-10-19'), status: 'CLOSED' as const, program: '', label: null },
  { id: 2, date: parseDate('2026-10-26'), status: 'OPEN' as const, program: '', label: null },
];
const entry = (factQty: number | null, changes: Partial<KEntry> = {}): KEntry => ({
  periodId: 1, date: periods[0].date, statusCode: null, countsAsDone: false, exclude: false,
  pct: null, factQty, ks: null, paid: null, p: null, isExample: false, enteredById: null, enteredAt: null,
  ...changes,
});
const item = (id: number, workTypeCode: string, planQty: number | null, entries: KEntry[]): KItem & { workTypeCode: string } => ({
  id, workTypeId: id, workTypeCode, unit: 'п.м', planQty, entries,
  planCost: null, planStart: null, planEnd: null, weight: null, isExample: false,
});
const site = (id: number, items: KItem[]): KSite => ({
  id, code: `site-${id}`, num: id, name: `Объект ${id}`, shortName: `Объект ${id}`, section: null, status: null,
  planStart: null, planEnd: null, limit: null, contracts: [], items, reports: [], curators: [], entry: [],
  lat: null, lon: null, isExample: false,
});
const direction = (sites: KSite[]): KDirection => ({
  id: 1, code: 'networks', name: 'Сети', shortName: 'Сети', isReadonly: false,
  periodKind: 'WEEK', planWeekday: 3, progressMethod: 'WEIGHTED_BY_COST', planMethod: 'NONE',
  moneySource: 'NONE', moneyLabel: null, thrWarn: -2, thrCrit: -10, siteUnit: 'объектов',
  settings: {}, periods, sites, trackers: [],
});
const kpi = (dir: KDirection, period = periods[0]) => directionKpi(dir, period, { warn: -2, crit: -10 }).kpi;

describe('сети по способу прокладки', () => {
  const dir = direction([
    site(1, [
      item(1, 'open', 100, [entry(50)]),
      item(2, 'open', 300, [entry(125), entry(275, { periodId: 2, date: periods[1].date })]),
      item(3, 'closed', 200, [entry(50)]),
      item(4, 'open', 1000, [entry(1000, { exclude: true })]),
      item(5, 'san', 2000, [entry(2000)]),
    ]),
    site(2, [item(6, 'closed', 100, [entry(0)])]),
  ]);

  it('считает объекты один раз на способ и готовность по сумме метров, исключая санацию и исключённые позиции', () => {
    const rows = kpi(dir).networkLaying;
    expect(rows).toEqual([
      { code: 'open', sites: 1, planQty: 400, factQty: 175, fact: 0.4375 },
      { code: 'closed', sites: 2, planQty: 300, factQty: 50, fact: 1 / 6 },
    ]);
  });

  it('использует факт выбранной недели, не подмешивая более поздние записи', () => {
    expect(kpi(dir, periods[1]).networkLaying?.[0]).toEqual({ code: 'open', sites: 1, planQty: 400, factQty: 325, fact: 0.8125 });
    expect(kpi(dir).networkLaying?.[0].factQty).toBe(175);
  });

  it('отличает нулевой факт от отсутствующих данных и не делит на нулевой проект', () => {
    const rows = kpi(direction([
      site(1, [item(1, 'open', 100, [entry(0)]), item(2, 'closed', 0, [entry(null)])]),
    ])).networkLaying;
    expect(rows).toEqual([
      { code: 'open', sites: 1, planQty: 100, factQty: 0, fact: 0 },
      { code: 'closed', sites: 1, planQty: 0, factQty: null, fact: null },
    ]);
  });

  it('не выдаёт неполную сумму за полный объём', () => {
    expect(kpi(direction([
      site(1, [item(1, 'open', 100, [entry(50)]), item(2, 'open', null, [])]),
    ])).networkLaying).toEqual([
      { code: 'open', sites: 1, planQty: null, factQty: null, fact: null },
      { code: 'closed', sites: 0, planQty: null, factQty: null, fact: null },
    ]);
  });

  it('не добавляет разбивку в другие направления и при отсутствии отчётной точки', () => {
    expect(kpi({ ...dir, code: 'mkd' }).networkLaying).toBeUndefined();
    expect(directionKpi(dir, null, { warn: -2, crit: -10 }).kpi.networkLaying).toBeUndefined();
  });
});
