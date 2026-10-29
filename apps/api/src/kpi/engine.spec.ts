/**
 * Движок расчёта против исходного дашборда: на загруженных демо-данных и при тех же датах плана,
 * что использовали исходные модули (МКД — пятница, Сети — понедельник, Школы — 27.10.2026),
 * движок должен дать те же показатели сводки, тот же список отстающих и те же доп. показатели.
 *
 * Нужна БД с нетронутыми демо-данными (после ручных правок: npm run db:demo -- --force):
 *   DATABASE_URL=… npx vitest run
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { directionKpi, mainProgram, type DirectionResult } from './engine';
import { loadDirection, loadPeriods } from './loader';
import { DAY_MS, parseDate } from './model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REF: Record<string, any> = JSON.parse(fs.readFileSync(path.join(__dirname, '../../prisma/demo/kpi_reference.json'), 'utf8'));
const THR = { warn: -2, crit: -10 };
const db = process.env.DATABASE_URL ? new PrismaClient() : null;

/** Даты плана исходных модулей. */
const ORIGINAL_PLAN: Record<string, (asOf: string) => number | undefined> = {
  mkd: (w) => parseDate(w) + 4 * DAY_MS,
  networks: (w) => parseDate(w),
  schools: () => parseDate('2026-10-27'),
  streets: () => undefined,
};

async function run(code: string, original: boolean): Promise<DirectionResult> {
  const d = await db!.direction.findUniqueOrThrow({ where: { code } });
  const periods = await loadPeriods(db!, d.id);
  const dir0 = await loadDirection(db!, d.id, periods, []);
  // точка, на которую снят эталон (после неё в базе могли появиться новые недели)
  const own = periods.filter((p) => p.program === mainProgram(dir0) && new Date(p.date).toISOString().slice(0, 10) <= REF[code].asOf);
  const period = own.at(-1)!;
  const ids = d.periodKind === 'REPORT' ? [period.id] : own.map((p) => p.id);
  const dir = await loadDirection(db!, d.id, periods, ids);
  const asOf = new Date(period.date).toISOString().slice(0, 10);
  return directionKpi(dir, period, THR, original ? ORIGINAL_PLAN[code](asOf) : undefined);
}

describe.skipIf(!db)('расчёт показателей = исходный дашборд', () => {
  const res: Record<string, DirectionResult> = {};
  beforeAll(async () => {
    for (const c of Object.keys(ORIGINAL_PLAN)) res[c] = await run(c, true);
  });
  afterAll(() => db?.$disconnect());

  for (const code of Object.keys(ORIGINAL_PLAN)) {
    it(`${code}: сводка`, () => {
      const k = res[code].kpi, r = REF[code];
      expect(k.asOf).toBe(r.asOf);
      expect(k.sites).toBe(r.objects);
      expect(k.fact).toBeCloseTo(r.fact, 9);
      if (r.plan == null) expect(k.plan).toBeNull();
      else expect(k.plan).toBeCloseTo(r.plan, 9);
      expect(k.lagging).toBe(r.lagging);
      expect(k.critical).toBe(r.critical);
      expect(k.people).toBe(r.people);
      expect(k.tech).toBe(r.tech);
      if (r.money == null) expect(k.money).toBeNull();
      else {
        expect(k.money!.portfolio).toBeCloseTo(r.money.portfolio, 1);
        r.money.closed == null ? expect(k.money!.closed).toBeNull() : expect(k.money!.closed).toBeCloseTo(r.money.closed, 1);
        r.money.paid == null ? expect(k.money!.paid).toBeNull() : expect(k.money!.paid).toBeCloseTo(r.money.paid, 1);
      }
    });
  }

  it('отстающие объекты: тот же список и порядок', () => {
    for (const code of ['mkd', 'networks', 'schools']) {
      const got = res[code].kpi.attention.map((a) => [a.code, +a.d.toFixed(9), a.crit]);
      const want = REF[code].attention.map((a: { id: string; d: number; crit: boolean }) => [a.id, +a.d.toFixed(9), a.crit]);
      expect(got, code).toEqual(want);
    }
  });

  it('замечания Благоустройства', () => {
    expect(res.streets.kpi.remarks!.map((r) => r.n)).toEqual(REF.streets.remarks.map((r: { n: number }) => r.n));
  });

  it('дополнительные показатели', () => {
    const v = (code: string) => Object.fromEntries(res[code].kpi.kpis.map((t) => [t.key, t]));
    const mkd = v('mkd'), net = v('networks'), sch = v('schools'), st = v('streets');
    expect((mkd.toPay.value! / 1e6).toFixed(1)).toBe('193.5');
    expect(mkd.overdueItems.value).toBe(11);
    expect(mkd.itemsByStatus.value).toBe(76);
    expect(Math.round(net.qtyByUnit.value!)).toBe(16120);
    expect(net.sitesDone.value).toBe(42);
    expect((net.advance.value! / 1e9).toFixed(1)).toBe('3.5');
    expect(sch.scheduleLagDays.value).toBe(55);
    expect(sch.trackerOverdue.value).toBe(3);
    expect([sch.trackerStatusDone.value, sch.trackerStatusDone.of]).toEqual([4, 4]);
    expect([st.reportStatusCount.value, st.reportStatusCount.of]).toEqual([26, 32]);
    expect(st.sitesWithRemainder.value).toBe(4);
    expect(st.remarksTotal.value).toBe(83);
  });

  it('по правилам приложения: план на среду (МКД, Сети) и на дату данных (Школы)', async () => {
    const rows = [];
    for (const code of Object.keys(ORIGINAL_PLAN)) {
      const k = (await run(code, false)).kpi;
      const o = res[code].kpi;
      rows.push({ code, planDate: k.planDate, fact: k.fact?.toFixed(4), plan: k.plan?.toFixed(4), planBefore: o.plan?.toFixed(4), lagging: `${k.lagging} (было ${o.lagging})`, critical: `${k.critical} (было ${o.critical})` });
      expect(k.fact).toBeCloseTo(o.fact!, 12); // факт от дня плана не зависит
    }
    console.table(rows);
  });
});
