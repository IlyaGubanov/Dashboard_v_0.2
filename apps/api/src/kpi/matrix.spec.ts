import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { workGrid } from './views';
import { parseDate, type KDirection, type KEntry, type KItem, type KSite } from './model';

const periods = [
  { id: 1, date: parseDate('2026-10-11'), status: 'CLOSED' as const, program: '', label: null },
  { id: 2, date: parseDate('2026-10-21'), status: 'OPEN' as const, program: '', label: null },
];
const entry = (pct: number | null, changes: Partial<KEntry> = {}): KEntry => ({
  periodId: 1, date: periods[0].date, statusCode: null, countsAsDone: false, exclude: false,
  pct, factQty: null, ks: null, paid: null, p: null, isExample: false, enteredById: null, enteredAt: null, ...changes,
});
const item = (entries: KEntry[], changes: Partial<KItem> = {}): KItem => ({
  id: 1, workTypeId: 1, workTypeCode: 'work', unit: 'м', planQty: 100, planCost: 100,
  planStart: parseDate('2026-10-01'), planEnd: parseDate('2026-10-21'), weight: 1, isExample: false, entries, ...changes,
});
const site = (items: KItem[]): KSite => ({
  id: 1, code: 'site', num: 1, name: 'Объект', shortName: 'Объект', section: null, status: null,
  planStart: parseDate('2026-10-01'), planEnd: parseDate('2026-10-21'), limit: null, contracts: [], items, reports: [],
  curators: [], entry: [], lat: null, lon: null, isExample: false,
});
const direction = (items: KItem[], changes: Partial<KDirection> = {}): KDirection => ({
  id: 1, code: 'test', name: 'Тест', shortName: 'Тест', isReadonly: false, periodKind: 'DAY', planWeekday: 3,
  progressMethod: 'SIMPLE_AVERAGE', planMethod: 'LINEAR_ITEM_DATES', moneySource: 'NONE', moneyLabel: null,
  thrWarn: -5, thrCrit: -15, siteUnit: 'объектов', settings: {}, periods, sites: [site(items)], trackers: [], ...changes,
});
// Подменена только граница чтения БД; расчёт и выбор исторической записи настоящие.
const db = {
  workType: { findMany: async () => [{ id: 1, code: 'work', name: 'Работа', unit: 'м', group: null }] },
  workItem: { findMany: async () => [] },
} as unknown as PrismaClient;
const grid = (items: KItem[], changes: Partial<KDirection> = {}, period = periods[0]) => workGrid(db, direction(items, changes), period);

describe('светофор позиций матрицы', () => {
  it.each([[20, 'crit'], [40, 'warn'], [48, 'ok'], [50, 'ok'], [60, 'ok'], [100, 'done']] as const)(
    'факт %s при плане 50 процентов: %s', async (fact, risk) => {
      const result = await grid([item([entry(fact)])]);
      expect(result.sites[0].items[0]).toMatchObject({ fact: fact / 100, plan: 0.5, risk });
    });
  it('20 процентов выше плана 15 процентов остаются зелёными', async () => {
    const r = await grid([item([entry(20)], { planEnd: parseDate('2026-12-07') })]);
    expect(r.sites[0].items[0]).toMatchObject({ fact: 0.2, risk: 'ok' });
  });
  it('80 процентов при плане 100 процентов остаются критичными', async () => {
    const r = await grid([item([entry(80)])], {}, periods[1]);
    expect(r.sites[0].items[0]).toMatchObject({ fact: 0.8, plan: 1, risk: 'crit' });
  });
  it('использует пороги направления', async () => {
    expect((await grid([item([entry(40)])], { thrWarn: -12, thrCrit: -25 })).sites[0].items[0]).toMatchObject({ risk: 'ok' });
  });
  it('без плана нейтрально, завершённое без плана зелёное', async () => {
    const r = await grid([item([entry(20)]), item([entry(100)], { id: 2 })], { planMethod: 'NONE' });
    expect(r.sites[0].items.map((i) => i.risk)).toEqual(['na', 'done']);
  });
  it('отличает отсутствующий факт от явно введённого нуля', async () => {
    const r = await grid([item([]), item([entry(null)], { id: 2 }), item([entry(0)], { id: 3 })]);
    expect(r.sites[0].items.map((i) => i.risk)).toEqual(['na', 'na', 'crit']);
    expect(r.sites[0].items.map((i) => i.fact)).toEqual([0, 0, 0]);
  });
  it('объём без проектного знаменателя не выдаётся за вычисленный процент', async () => {
    const r = await grid([item([entry(null, { factQty: 20 })], { planQty: null })]);
    expect(r.sites[0].items[0]).toMatchObject({ fact: 0, hasFact: false, risk: 'na' });
  });
  it('не начатая по графику позиция нейтральна', async () => {
    expect((await grid([item([entry(0)], { planStart: parseDate('2026-10-15') })])).sites[0].items[0]).toMatchObject({ risk: 'wait' });
  });
  it('просрочка предупреждает даже внутри допуска', async () => {
    expect((await grid([item([entry(99)], { planEnd: parseDate('2026-10-10') })])).sites[0].items[0]).toMatchObject({ overdue: true, risk: 'warn' });
  });
  it('исключённая позиция не создаёт риск', async () => {
    expect((await grid([item([entry(0, { exclude: true })])])).sites[0].items[0]).toMatchObject({ excluded: true, risk: 'na', plan: null });
  });
  it('исторический срез не использует последующие записи', async () => {
    const rows = [item([entry(20), entry(100, { periodId: 2, date: periods[1].date })])];
    expect((await grid(rows)).sites[0].items[0]).toMatchObject({ fact: 0.2, risk: 'crit' });
    expect((await grid(rows, {}, periods[1])).sites[0].items[0]).toMatchObject({ fact: 1, risk: 'done' });
  });
  it('график уровня объекта используется для оценки и пояснения (Сети)', async () => {
    const r = await grid([item([entry(40)], { planStart: null, planEnd: null })], { planMethod: 'LINEAR_SITE_DATES' });
    expect(r.sites[0].items[0]).toMatchObject({ fact: 0.4, plan: null, risk: 'warn', riskPlan: 0.5 });
  });
  it('нет отчётной точки — нет оценки по текущему дню', async () => {
    expect((await workGrid(db, direction([item([entry(20)])]), null)).sites[0].items[0]).toMatchObject({ risk: 'na' });
  });
});
