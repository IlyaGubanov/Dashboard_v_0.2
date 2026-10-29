/**
 * Сверка загруженных данных с исходным дашбордом.
 * Пересчитывает показатели направлений из БД по формулам исходных модулей и сравнивает
 * с тем, что показывала их «Сводка» (kpi_reference.json — снято 27.10.2026).
 *
 *   npm run db:demo:verify
 *
 * Это проверка переноса, а не рабочий расчёт: рабочий расчёт показателей — этап 4 (API).
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './lib';

const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'kpi_reference.json'), 'utf8'));
const DAY = 86_400_000;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, k: number) => iso(new Date(Date.parse(s) + k * DAY));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

let failed = 0;
function check(dir: string, label: string, ref: number | null | undefined, got: number | null, tol = 1e-6) {
  const ok = ref == null ? got == null : got != null && Math.abs(got - ref) <= tol * Math.max(1, Math.abs(ref));
  if (!ok) failed++;
  const f = (v: number | null | undefined) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(4));
  console.log(`${ok ? '✓' : '✗'} ${dir.padEnd(16)} ${label.padEnd(30)} дашборд ${f(ref).padStart(16)}   БД ${f(got).padStart(16)}`);
}

/** Последний факт на дату (как в модулях: берётся последняя запись не позже недели). */
function latest<T extends { period: { date: Date } }>(rows: T[], until: string): T | null {
  let best: T | null = null;
  for (const r of rows) if (iso(r.period.date) <= until && (!best || r.period.date > best.period.date)) best = r;
  return best;
}

async function mkd() {
  const dir = await prisma.direction.findUniqueOrThrow({ where: { code: 'mkd' } });
  const ref = REF.mkd;
  const week = ref.asOf as string;
  const dRef = addDays(week, 4); // исходный модуль считал план на пятницу отчётной недели
  const items = await prisma.workItem.findMany({
    where: { isArchived: false, site: { directionId: dir.id, isArchived: false } },
    include: { progress: { include: { period: true, status: true } } },
  });
  const thrWarn = n(dir.thrWarn), thrCrit = n(dir.thrCrit);
  const planPct = (s: Date | null, e: Date | null) => {
    if (!s || !e) return null;
    const d = Date.parse(dRef);
    if (d <= s.getTime()) return 0;
    if (d >= e.getTime()) return 100;
    return (100 * (d - s.getTime())) / (e.getTime() - s.getTime());
  };
  const bySite = new Map<number, { w: number; wp: number; wD: number; wpD: number; wpl: number; overdue: number }>();
  let contract = 0, ks = 0, paid = 0, w = 0, wp = 0, wD = 0, wpl = 0;
  for (const it of items) {
    const s = latest(it.progress, week);
    const st = s?.status?.code ?? 'plan';
    const done = !!s?.status?.countsAsDone;
    const excl = !!s?.status?.excludeFromCalc;
    const pct = excl ? 0 : done ? 100 : clamp(n(s?.pct), 0, 100);
    const plan = excl ? null : planPct(it.planStart, it.planEnd);
    const c = n(it.planCost);
    contract += c; ks += n(s?.ksAmount); paid += n(s?.paidAmount);
    const a = bySite.get(it.siteId) ?? { w: 0, wp: 0, wD: 0, wpD: 0, wpl: 0, overdue: 0 };
    if (!excl) {
      w += c; wp += c * pct; a.w += c; a.wp += c * pct;
      if (plan != null) { wD += c; wpl += c * plan; a.wD += c; a.wpD += c * pct; a.wpl += c * plan; }
    }
    if (it.planEnd && iso(it.planEnd) < dRef && pct < 100 && st !== 'excl') a.overdue++;
    bySite.set(it.siteId, a);
  }
  let lag = 0, crit = 0;
  for (const a of bySite.values()) {
    const l = a.wD ? a.wpD / a.wD - a.wpl / a.wD : null;
    const r = l == null ? 'na' : l < thrCrit ? 'crit' : l < thrWarn || a.overdue > 0 ? 'warn' : 'ok';
    if (r === 'crit') crit++;
    if (r === 'crit' || r === 'warn') lag++;
  }
  check('МКД', 'Адресов', ref.objects, bySite.size);
  check('МКД', 'Готовность (факт)', ref.fact, wp / w / 100);
  check('МКД', 'План на дату', ref.plan, wpl / wD / 100);
  check('МКД', 'Отстают от графика', ref.lagging, lag);
  check('МКД', 'Критично', ref.critical, crit);
  check('МКД', 'Договор, ₽', ref.money.portfolio, contract);
  check('МКД', 'КС-2, ₽', ref.money.closed, ks);
  check('МКД', 'Оплачено, ₽', ref.money.paid, paid);
}

async function networks() {
  const dir = await prisma.direction.findUniqueOrThrow({ where: { code: 'networks' } });
  const ref = REF.networks;
  const week = ref.asOf as string; // исходный модуль считал план на понедельник недели
  const sites = await prisma.site.findMany({
    where: { directionId: dir.id, isArchived: false },
    include: {
      contracts: true,
      reports: { include: { period: true } },
      workItems: { include: { progress: { include: { period: true } } } },
    },
  });
  const t = Date.parse(week);
  let c = 0, f = 0, p = 0, people = 0, tech = 0, portfolio = 0, closed = 0, lagN = 0, critN = 0;
  for (const s of sites) {
    const ls = s.workItems;
    let fact = 0;
    if (ls.length) {
      const facts = ls.map((l) => ({ plan: n(l.planQty), f: n(latest(l.progress, week)?.factQty), unit: l.unit }));
      if (facts.every((x) => x.unit === facts[0].unit)) {
        const P = facts.reduce((a, x) => a + x.plan, 0);
        fact = P ? facts.reduce((a, x) => a + Math.min(x.f, x.plan), 0) / P : 0;
      } else fact = facts.reduce((a, x) => a + (x.plan ? Math.min(1, x.f / x.plan) : 0), 0) / facts.length;
    }
    const st = s.planStart?.getTime(), en = s.planEnd?.getTime();
    const plan = !st || !en ? 0 : en <= st ? (t >= en ? 1 : 0) : clamp((t - st) / (en - st), 0, 1);
    const cost = s.contracts.reduce((a, x) => a + n(x.amount), 0);
    const wgt = cost || 1;
    c += wgt; f += wgt * fact; p += wgt * plan; portfolio += cost;
    const r = latest(s.reports, week);
    people += n(r?.workers); tech += n(r?.machines); closed += n(r?.ksAmount);
    if (fact < 0.995 && !(plan < 0.005 && fact < 0.005)) {
      const d = fact - plan;
      if (d < n(dir.thrWarn) / 100) lagN++;
      if (d < n(dir.thrCrit) / 100) critN++;
    }
  }
  check('Сети', 'Объектов', ref.objects, sites.length);
  check('Сети', 'Выполнение (факт)', ref.fact, f / c);
  check('Сети', 'План на дату', ref.plan, p / c);
  check('Сети', 'Отстают от графика', ref.lagging, lagN);
  check('Сети', 'Критично', ref.critical, critN);
  check('Сети', 'Рабочих', ref.people, people);
  check('Сети', 'Техники', ref.tech, tech);
  check('Сети', 'Договоры, ₽', ref.money.portfolio, portfolio);
  check('Сети', 'Закрыто КС, ₽', ref.money.closed, closed);
}

async function schools() {
  const dir = await prisma.direction.findUniqueOrThrow({ where: { code: 'schools' } });
  const ref = REF.schools;
  const today = Date.parse('2026-10-27'); // исходный модуль считал план «на сегодня»; эталон снят 27.10.2026
  const types = await prisma.workType.findMany({ where: { directionId: dir.id } });
  const sites = await prisma.site.findMany({
    where: { directionId: dir.id, isArchived: false },
    include: { workItems: { include: { progress: true } }, reports: { include: { period: true } } },
  });
  const factOf = (s: (typeof sites)[number], typeId: number) => {
    const it = s.workItems.find((x) => x.workTypeId === typeId);
    const e = it?.progress[0];
    if (!it || !e) return 0;
    if (n(it.planQty) > 0 && e.factQty != null) return Math.min(1, n(e.factQty) / n(it.planQty));
    return n(e.pct) / 100;
  };
  const planW = (wt: (typeof types)[number]) => {
    if (!wt.planStart || !wt.planEnd) return 0;
    const s = wt.planStart.getTime(), e = wt.planEnd.getTime();
    return e <= s ? (today >= e ? 1 : 0) : clamp((today - s) / (e - s), 0, 1);
  };
  const total = (objs: typeof sites) =>
    types.reduce((a, wt) => a + n(wt.weight) * (objs.length ? objs.reduce((x, o) => x + factOf(o, wt.id), 0) / objs.length : 0), 0);
  const P = types.reduce((a, wt) => a + n(wt.weight) * planW(wt), 0);
  let lag = 0, crit = 0, people = 0, tech = 0, paid = 0;
  for (const s of sites) {
    const f = total([s]), d = f - P;
    if (f < 0.999 && d < -0.02) lag++;
    if (f < 0.999 && !(P === 0 && f === 0) && d < -0.1) crit++;
    const r = s.reports.find((x) => iso(x.period.date) === ref.asOf);
    people += n(r?.workers) + n(r?.workersBlocked); tech += n(r?.machines) + n(r?.machinesBlocked); paid += n(r?.paidAmount);
  }
  check('Школы', 'Школ', ref.objects, sites.length);
  check('Школы', 'Готовность ДКР (факт)', ref.fact, total(sites));
  check('Школы', 'План на дату', ref.plan, P);
  check('Школы', 'Отстают от графика', ref.lagging, lag);
  check('Школы', 'Критично', ref.critical, crit);
  check('Школы', 'Людей', ref.people, people);
  check('Школы', 'Техники', ref.tech, tech);
  check('Школы', 'Лимит, ₽', ref.money.portfolio, sites.reduce((a, s) => a + n(s.limitAmount), 0));
  check('Школы', 'Оплачено, ₽', ref.money.paid, paid);
}

async function streets() {
  const dir = await prisma.direction.findUniqueOrThrow({ where: { code: 'streets' } });
  const ref = REF.streets;
  const period = await prisma.reportingPeriod.findFirstOrThrow({
    where: { directionId: dir.id, program: 'kbu' },
    orderBy: { date: 'desc' },
    include: { reports: true, progress: true },
  });
  let pos = 0, done = 0;
  for (const e of period.progress) {
    const p = n((e.attrs as { p?: number } | null)?.p);
    if (p > 0) {
      pos++;
      if (e.factQty != null && n(e.factQty) + 1e-7 >= p) done++;
    }
  }
  const finished = period.reports.filter((r) => ['Работы завершены', 'Сдан ЦККБ'].includes(r.statusText ?? '')).length;
  check('Благоустройство', 'Дата отчёта', Date.parse(ref.asOf), period.date.getTime());
  check('Благоустройство', 'Объектов в отчёте', ref.objects, period.reports.length);
  check('Благоустройство', 'Доля выполненных позиций', ref.fact, pos ? done / pos : null);
  check('Благоустройство', 'Завершены по статусу', Number(ref.kpis[0].v.split(' ')[0]), finished);
  check('Благоустройство', 'Замечаний в отчёте', Number(ref.kpis[2].v), period.reports.reduce((a, r) => a + n(r.remarksCount), 0));
}

async function main() {
  await schools();
  await mkd();
  await networks();
  await streets();
  console.log(failed ? `\nРасхождений: ${failed}` : '\nВсе показатели совпадают с исходным дашбордом.');
  if (failed) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
