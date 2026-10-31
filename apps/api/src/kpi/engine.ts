/**
 * Расчёт показателей направления — чистые функции без БД.
 *
 * Правила (одни для всех направлений, различия — в настройках направления):
 *
 *  Факт позиции (доля 0…1):
 *    статус «считается выполненным» (КС-2, оплачено) → 1; статус «исключено» → позиция не участвует;
 *    есть проектный и фактический объём → min(1, факт / проект); иначе → % готовности.
 *    Для недель и дней берётся последняя запись не позже отчётной точки, для отчётов — запись этого отчёта.
 *  План позиции: линейно от начала до окончания на дату плана
 *    (неделя — понедельник + plan_weekday − 1, день и отчёт — сама дата).
 *  Вес позиции внутри объекта:
 *    WEIGHTED_BY_WORK_WEIGHT — вес вида работ (сумма не нормируется, как в исходном дашборде Школ);
 *    WEIGHTED_BY_COST + деньги по позициям — стоимость позиции;
 *    иначе — проектный объём, если у всех позиций объекта одна единица, или 1.
 *  Готовность направления:
 *    по позициям со стоимостью (МКД) — Σ стоимость × факт / Σ стоимость по всем позициям;
 *    по весам видов работ (Школы) — среднее по объектам;
 *    доля выполненных позиций (Благоустройство) — выполнено / позиций с проектным объёмом;
 *    иначе — среднее по объектам, взвешенное суммой договоров (лимитом) объекта, без денег — 1.
 *  Состояние объекта: выполнено (≥ 99,5 %), не начато по графику (план и факт < 0,5 %),
 *    критично (отставание < thr_crit п.п.), отставание (< thr_warn п.п. или есть просроченные позиции), в графике.
 */
import {
  riskLevel,
  type DirectionKpi,
  type DynamicsPoint,
  type KpiAttention,
  type KpiRemarkRow,
  type Forecast,
  type SiteKpiRow,
  type SiteRisk,
} from '@mvs/shared';
import { DAY_MS, isoDate, type KDirection, type KEntry, type KItem, type KPeriod, type KReport, type KSite } from './model';
import { computeTiles } from './metrics';
import { basePeriod, forecastOf, sitePlanEnd } from './forecast';
import { networkLaying } from './network-laying';

export interface ItemCalc {
  item: KItem;
  entry: KEntry | null;
  excluded: boolean;
  fact: number;
  plan: number | null;
  weight: number;
  overdue: boolean;
}

export interface SiteCalc {
  site: KSite;
  items: ItemCalc[];
  report: KReport | null;
  /** суммы для агрегирования: W — веса, WF — Σ вес × факт, WD/WFD/WP — то же по позициям с графиком */
  W: number;
  WF: number;
  WD: number;
  WFD: number;
  WP: number;
  fact: number | null;
  /** максимально возможный факт объекта (Школы: сумма весов видов работ) */
  factMax: number;
  plan: number | null;
  lag: number | null;
  risk: SiteRisk;
  /** позиций с проектным объёмом / из них выполнено (доля выполненных позиций) */
  pos: number;
  posDone: number;
  overdueItems: number;
  /** замечаний не закрыто / из них просрочено на дату среза */
  remarksOpen: number;
  remarksOverdue: number;
  /** прогноз завершения (заполняется в directionKpi и в карточке объекта) */
  forecast?: Forecast;
  money: { portfolio: number | null; closed: number | null; paid: number | null };
  people: number | null;
  tech: number | null;
}

export interface CalcResult {
  sites: SiteCalc[];
  fact: number | null;
  plan: number | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sumOrNull = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

/** Дата, на которую считается план отчётной точки. */
export function planDateFor(dir: KDirection, period: KPeriod): number {
  return dir.periodKind === 'WEEK' ? period.date + (dir.planWeekday - 1) * DAY_MS : period.date;
}

/** Плановая доля на дату t при линейном графике от s до e. */
export function linear(s: number | null, e: number | null, t: number): number | null {
  if (s == null || e == null) return null;
  if (e <= s) return t >= e ? 1 : 0;
  return clamp01((t - s) / (e - s));
}

/** Есть ли на отчётную точку хоть одна запись факта (иначе сравнивать с ней нечего). */
export function hasFactAt(dir: KDirection, period: KPeriod): boolean {
  return dir.sites.some((s) =>
    s.items.some((i) => i.entries.some((e) => (dir.periodKind === 'REPORT' ? e.periodId === period.id : e.date <= period.date))),
  );
}

/** Основная программа отчётов направления (Благоустройство: КБУ). */
export function mainProgram(dir: KDirection): string {
  return dir.periodKind === 'REPORT' ? (Object.keys(dir.settings.programs ?? {})[0] ?? '') : '';
}

/** Индекс «отчёт → запись» для каждого списка записей (строится один раз, нужен для динамики по сотням отчётов). */
const byPeriod = new WeakMap<object, Map<number, unknown>>();

function pickAt<T extends { periodId: number; date: number }>(rows: T[], dir: KDirection, period: KPeriod): T | null {
  if (dir.periodKind === 'REPORT') {
    let idx = byPeriod.get(rows) as Map<number, T> | undefined;
    if (!idx) byPeriod.set(rows, (idx = new Map(rows.map((r) => [r.periodId, r]))));
    return idx.get(period.id) ?? null;
  }
  let best: T | null = null;
  for (const r of rows) if (r.date <= period.date) best = r; // rows отсортированы по дате
  return best;
}

const itemsByCost = (dir: KDirection) => dir.progressMethod === 'WEIGHTED_BY_COST' && dir.moneySource === 'WORK_ITEMS';

/**
 * Замечания на дату среза. Для последней отчётной точки — на сейчас, для прошлых — на конец дня плана:
 * замечание открыто, если создано до среза и не закрыто к нему; просрочено, если срок раньше дня среза.
 */
export function remarksAt(dir: KDirection, site: KSite, period: KPeriod, now = Date.now()) {
  const log = site.remarkLog ?? [];
  if (!log.length) return { remarksOpen: 0, remarksOverdue: 0 };
  const last = dir.periods[dir.periods.length - 1]?.id === period.id;
  const T = last ? now : planDateFor(dir, period) + DAY_MS;
  const day = T - (T % DAY_MS);
  const open = log.filter((r) => r.created < T && (r.closed == null || r.closed >= T));
  return { remarksOpen: open.length, remarksOverdue: open.filter((r) => r.due != null && r.due < day).length };
}

export function calcSite(dir: KDirection, site: KSite, period: KPeriod, P: number): SiteCalc {
  const sameUnit = site.items.every((i) => i.unit === site.items[0]?.unit);
  const weightOf = (it: KItem) => {
    if (dir.progressMethod === 'WEIGHTED_BY_WORK_WEIGHT') return it.weight ?? 0;
    if (dir.progressMethod === 'SIMPLE_AVERAGE') return 1;
    if (itemsByCost(dir)) return it.planCost ?? 0;
    return sameUnit ? (it.planQty ?? 0) : 1;
  };

  const items: ItemCalc[] = site.items.map((it) => {
    const e = pickAt(it.entries, dir, period);
    const excluded = !!e?.exclude;
    let fact = 0;
    if (e?.countsAsDone) fact = 1;
    else if (e && it.planQty != null && it.planQty > 0 && e.factQty != null) fact = Math.min(1, e.factQty / it.planQty);
    else if (e?.pct != null) fact = clamp01(e.pct / 100);
    const plan = excluded || dir.planMethod === 'NONE' ? null : linear(it.planStart, it.planEnd, P);
    const overdue = dir.planMethod === 'LINEAR_ITEM_DATES' && !excluded && it.planEnd != null && it.planEnd < P && fact < 1;
    return { item: it, entry: e, excluded, fact, plan, weight: weightOf(it), overdue };
  });

  const c: SiteCalc = {
    site, items, report: pickAt(site.reports, dir, period),
    W: 0, WF: 0, WD: 0, WFD: 0, WP: 0, fact: null, factMax: 1, plan: null, lag: null, risk: 'na',
    pos: 0, posDone: 0, overdueItems: items.filter((i) => i.overdue).length,
    ...remarksAt(dir, site, period),
    money: { portfolio: null, closed: null, paid: null }, people: null, tech: null,
  };

  for (const i of items) {
    if (i.excluded) continue;
    c.W += i.weight;
    c.WF += i.weight * i.fact;
    if (i.plan != null) {
      c.WD += i.weight;
      c.WFD += i.weight * i.fact;
      c.WP += i.weight * i.plan;
    }
    const p = i.entry?.p ?? (dir.periodKind === 'REPORT' ? null : i.item.planQty);
    if (p != null && p > 0 && i.entry) {
      c.pos++;
      if (i.entry.factQty != null && i.entry.factQty + 1e-7 >= p) c.posDone++;
    }
  }

  switch (dir.progressMethod) {
    case 'WEIGHTED_BY_WORK_WEIGHT':
      c.fact = c.WF;
      c.factMax = c.W || 1;
      c.plan = dir.planMethod === 'NONE' ? null : c.WP;
      c.lag = c.plan == null ? null : c.fact - c.plan;
      break;
    case 'SHARE_COMPLETED':
      c.fact = c.pos ? c.posDone / c.pos : null;
      break;
    default:
      c.fact = c.W ? c.WF / c.W : 0;
      if (dir.planMethod === 'LINEAR_ITEM_DATES') {
        c.plan = c.WD ? c.WP / c.WD : null;
        c.lag = c.WD ? c.WFD / c.WD - c.plan! : null;
      } else if (dir.planMethod === 'LINEAR_SITE_DATES') {
        c.plan = linear(site.planStart, site.planEnd, P) ?? 0;
        c.lag = c.fact - c.plan;
      }
  }

  const factN = c.fact == null ? null : c.fact / c.factMax;
  if (factN != null && factN >= 0.995) c.risk = 'done';
  else if (c.lag == null) c.risk = 'na';
  else if (c.plan != null && c.plan < 0.005 && factN != null && factN < 0.005) c.risk = 'wait';
  else if (c.lag * 100 < dir.thrCrit) c.risk = 'crit';
  else if (c.lag * 100 < dir.thrWarn || c.overdueItems > 0) c.risk = 'warn';
  else c.risk = 'ok';

  // деньги
  const live = items.filter((i) => i.entry);
  const itemKs = sumOrNull(live.map((i) => i.entry!.ks));
  const itemPaid = sumOrNull(live.map((i) => i.entry!.paid));
  c.money = {
    portfolio:
      dir.moneySource === 'WORK_ITEMS'
        ? sumOrNull(site.items.map((i) => i.planCost))
        : dir.moneySource === 'CONTRACTS'
          ? sumOrNull(site.contracts.map((x) => x.amount))
          : dir.moneySource === 'SITE_LIMIT'
            ? site.limit
            : null,
    closed: itemKs ?? c.report?.ks ?? null,
    paid: itemPaid ?? c.report?.paid ?? null,
  };
  const r = c.report;
  c.people = r ? sumOrNull([r.workers, r.workersBlocked]) : null;
  c.tech = r ? sumOrNull([r.machines, r.machinesBlocked]) : null;
  return c;
}

/** Факт и план направления по объектам. */
function aggregate(dir: KDirection, sites: SiteCalc[]): { fact: number | null; plan: number | null } {
  if (!sites.length) return { fact: null, plan: null };
  if (dir.progressMethod === 'SHARE_COMPLETED') {
    const pos = sites.reduce((a, s) => a + s.pos, 0);
    return { fact: pos ? sites.reduce((a, s) => a + s.posDone, 0) / pos : null, plan: null };
  }
  if (dir.progressMethod === 'WEIGHTED_BY_WORK_WEIGHT') {
    const mean = (f: (s: SiteCalc) => number | null) => sites.reduce((a, s) => a + (f(s) ?? 0), 0) / sites.length;
    return { fact: mean((s) => s.fact), plan: dir.planMethod === 'NONE' ? null : mean((s) => s.plan) };
  }
  if (itemsByCost(dir)) {
    const W = sites.reduce((a, s) => a + s.W, 0), WD = sites.reduce((a, s) => a + s.WD, 0);
    return {
      fact: W ? sites.reduce((a, s) => a + s.WF, 0) / W : 0,
      plan: WD ? sites.reduce((a, s) => a + s.WP, 0) / WD : null,
    };
  }
  let c = 0, f = 0, p = 0, withPlan = false;
  for (const s of sites) {
    const w = s.money.portfolio || 1;
    c += w;
    f += w * (s.fact ?? 0);
    if (s.plan != null) withPlan = true;
    p += w * (s.plan ?? 0);
  }
  return { fact: c ? f / c : null, plan: withPlan && c ? p / c : null };
}

/** Объекты и итог направления на отчётную точку. planDate — для сверки с исходным дашбордом. */
export function calculate(dir: KDirection, period: KPeriod, planDate?: number): CalcResult {
  const P = planDate ?? planDateFor(dir, period);
  const sites = dir.sites.map((s) => calcSite(dir, s, period, P));
  return { sites, ...aggregate(dir, sites) };
}

function factLabel(dir: KDirection) {
  if (dir.settings.factLabel) return dir.settings.factLabel;
  switch (dir.progressMethod) {
    case 'WEIGHTED_BY_WORK_WEIGHT':
      return 'Готовность (взвешенная по видам работ)';
    case 'SHARE_COMPLETED':
      return 'Позиций с выполненным проектным объёмом';
    case 'SIMPLE_AVERAGE':
      return 'Средняя готовность позиций';
    default:
      return dir.moneySource === 'CONTRACTS' ? 'Выполнение (взвешенное по стоимости договоров)' : 'Физическая готовность (взвешенная по стоимости)';
  }
}

export interface DirectionResult {
  kpi: DirectionKpi;
  rows: SiteKpiRow[];
}

/** Готовность объекта 0…1 (Школы: доля от суммы весов). */
const norm = (s: SiteCalc) => (s.fact == null ? null : s.fact / s.factMax);

/** Прогноз объекта: c — расчёт на срез, base — расчёт того же объекта на базовую точку. */
export function siteForecast(dir: KDirection, period: KPeriod, c: SiteCalc, base: { period: KPeriod; calc: SiteCalc | undefined } | null): Forecast | undefined {
  if (dir.periodKind === 'REPORT') return undefined;
  return forecastOf(norm(c), base?.calc ? norm(base.calc) : null, period.date, base?.period.date ?? null, sitePlanEnd(c.site));
}

/** Прогнозы объектов (в r.sites[].forecast) и направления. */
function forecasts(dir: KDirection, period: KPeriod, r: CalcResult): Forecast | null {
  if (dir.periodKind === 'REPORT') return null;
  const bp = basePeriod(dir, period);
  const rb = bp ? calculate(dir, bp) : null;
  const byId = new Map(rb?.sites.map((s) => [s.site.id, s]) ?? []);
  for (const s of r.sites) s.forecast = siteForecast(dir, period, s, bp ? { period: bp, calc: byId.get(s.site.id) } : null);
  // готовность направления в долях: у Школ — среднее по объектам относительно суммы весов
  const scale = dir.progressMethod === 'WEIGHTED_BY_WORK_WEIGHT' && r.sites.length ? r.sites.reduce((a, s) => a + s.factMax, 0) / r.sites.length : 1;
  const ends = r.sites.map((s) => sitePlanEnd(s.site)).filter((x): x is number => x != null);
  return forecastOf(r.fact == null ? null : r.fact / scale, rb?.fact == null ? null : rb.fact / scale, period.date, bp?.date ?? null, ends.length ? Math.max(...ends) : null);
}

/** Показатели направления в формате сводки + строки реестра объектов. */
export function directionKpi(
  dir: KDirection,
  period: KPeriod | null,
  overview: { warn: number; crit: number },
  planDate?: number,
): DirectionResult {
  const empty: DirectionKpi = {
    code: dir.code, asOf: null, asOfKind: dir.periodKind, periodId: null, periodStatus: null, verified: false, planDate: null,
    sites: dir.sites.length, siteUnit: dir.siteUnit, lagging: null, critical: null, done: null, fact: null, plan: null,
    factLabel: factLabel(dir), risk: 'na', prev: null, people: null, tech: null, money: null, kpis: [], attention: [], forecast: null, forecastLate: null, hasExamples: false,
  };
  if (!period) return { kpi: empty, rows: [] };

  const P = planDate ?? planDateFor(dir, period);
  const r = calculate(dir, period, P);
  const fc = forecasts(dir, period, r);
  const hasPlan = dir.planMethod !== 'NONE';
  const count = (k: SiteRisk[]) => r.sites.filter((s) => k.includes(s.risk)).length;
  const deviation = r.fact != null && r.plan != null ? (r.fact - r.plan) * 100 : null;
  const sum = (f: (s: SiteCalc) => number | null) => sumOrNull(r.sites.map(f));

  const attention: KpiAttention[] = r.sites
    .filter((s) => (s.risk === 'warn' || s.risk === 'crit') && s.lag != null)
    .sort((a, b) => a.lag! - b.lag!)
    .slice(0, 8)
    .map((s) => ({
      siteId: s.site.id, code: s.site.code, name: s.site.shortName, section: s.site.section?.name ?? null,
      fact: s.fact, plan: s.plan, d: s.lag!, crit: s.risk === 'crit',
    }));

  const remarks: KpiRemarkRow[] | undefined =
    dir.periodKind === 'REPORT'
      ? r.sites
          .filter((s) => (s.report?.remarks ?? 0) > 0)
          .sort((a, b) => b.report!.remarks! - a.report!.remarks!)
          .slice(0, 8)
          .map((s) => ({ siteId: s.site.id, name: s.site.shortName, status: s.report!.statusText, n: s.report!.remarks!, open: s.pos - s.posDone }))
      : undefined;

  const examples = dir.sites.some((s) => s.isExample || s.items.some((i) => i.isExample || i.entries.some((e) => e.isExample)));

  const kpi: DirectionKpi = {
    ...empty,
    asOf: isoDate(period.date),
    periodId: period.id,
    periodStatus: period.status,
    verified: period.status !== 'OPEN',
    planDate: hasPlan ? isoDate(P) : null,
    sites: dir.periodKind === 'REPORT' ? r.sites.filter((s) => s.report).length : r.sites.length,
    lagging: hasPlan ? count(['warn', 'crit']) : null,
    critical: hasPlan ? count(['crit']) : null,
    done: count(['done']),
    fact: r.fact,
    plan: r.plan,
    risk: hasPlan ? riskLevel(deviation, overview.warn, overview.crit) : 'na',
    people: sum((s) => s.people),
    tech: sum((s) => s.tech),
    money:
      dir.moneySource === 'NONE'
        ? null
        : {
            portfolio: sum((s) => s.money.portfolio),
            portfolioLabel: dir.moneyLabel ?? 'Стоимость',
            closed: sum((s) => s.money.closed),
            paid: sum((s) => s.money.paid),
          },
    kpis: computeTiles(dir, period, P, r),
    networkLaying: dir.code === 'networks' ? networkLaying(r.sites) : undefined,
    attention,
    forecast: fc,
    forecastLate: hasPlan && fc ? r.sites.filter((s) => s.forecast?.status === 'late' || (s.forecast?.status === 'stalled' && s.forecast.planEnd)).length : null,
    remarks,
    hasExamples: examples,
  };

  return { kpi, rows: r.sites.map(toRow) };
}

/** Строка реестра по рассчитанному объекту. */
export function toRow(s: SiteCalc): SiteKpiRow {
  return {
    id: s.site.id,
    code: s.site.code,
    num: s.site.num,
    name: s.site.name,
    shortName: s.site.shortName,
    section: s.site.section,
    status: s.site.status,
    statusText: s.report?.statusText ?? null,
    fact: s.fact,
    plan: s.plan,
    lag: s.lag,
    risk: s.risk,
    planStart: s.site.planStart == null ? null : isoDate(s.site.planStart),
    planEnd: s.site.planEnd == null ? null : isoDate(s.site.planEnd),
    money: s.money,
    people: s.people,
    tech: s.tech,
    remarks: s.report?.remarks ?? null,
    remarksOpen: s.remarksOpen,
    remarksOverdue: s.remarksOverdue,
    forecast: s.forecast ?? null,
    overdueItems: s.overdueItems,
    curators: s.site.curators,
    entry: s.site.entry,
    contractor: s.site.contractor ?? null,
    subcontractors: s.site.subcontractors ?? [],
    lat: s.site.lat,
    lon: s.site.lon,
    isExample: s.site.isExample,
  };
}

const pointOf = (period: KPeriod, fact: number | null, plan: number | null, sites: SiteCalc[]): DynamicsPoint => ({
  date: isoDate(period.date),
  label: period.label,
  verified: period.status !== 'OPEN',
  fact,
  plan,
  people: sumOrNull(sites.map((s) => s.people)),
  tech: sumOrNull(sites.map((s) => s.tech)),
  closed: sumOrNull(sites.map((s) => s.money.closed)),
  paid: sumOrNull(sites.map((s) => s.money.paid)),
});

/** Динамика направления по отчётным точкам (только точки, за которые есть факт). */
export function dynamics(dir: KDirection, periods: KPeriod[]): DynamicsPoint[] {
  return periods
    .filter((p) => hasFactAt(dir, p) || dir.sites.some((s) => s.reports.some((r) => r.periodId === p.id)))
    .map((p) => {
      const r = calculate(dir, p);
      return pointOf(p, hasFactAt(dir, p) ? r.fact : null, hasFactAt(dir, p) ? r.plan : null, r.sites);
    });
}

/** Динамика одного объекта по отчётным точкам. */
export function siteHistory(dir: KDirection, site: KSite, periods: KPeriod[]): DynamicsPoint[] {
  const has = (p: KPeriod) =>
    site.items.some((i) => i.entries.some((e) => (dir.periodKind === 'REPORT' ? e.periodId === p.id : e.date <= p.date))) ||
    site.reports.some((r) => r.periodId === p.id);
  return periods.filter(has).map((p) => {
    const c = calcSite(dir, site, p, planDateFor(dir, p));
    return pointOf(p, c.fact, c.plan, [c]);
  });
}
