/**
 * Сравнение факта ПЭО с планом затрат на выполненный объём (лимит × готовность работ из дашборда).
 * Прямые статьи сравниваются по каждому центру затрат; общепроизводственные и административные —
 * после разнесения по выручке (этап 2), здесь они только в структуре лимита и в помесячных расходах.
 */
import { econDeviation, econForecast, econIsCompanyKind, econPlanCost, econStatus, type EconArticle, type EconBudget, type EconOverview, type EconResult, type EconStatus } from '@mvs/shared';

export interface Measure {
  limit: number | null;
  plan: number | null;
  fact: number | null;
  dev: number | null;
  devPct: number | null;
  status: EconStatus;
}
export interface BudgetAnalysis {
  b: EconBudget;
  progress: number | null;
  res: EconResult | undefined;
  direct: Measure;
  spentPct: number | null;
  forecast: { expected: number; result: number | null } | null;
  byArticle: Map<number, Measure>;
  labor: Measure;
  machine: Measure;
  months: number;
}

const sum = (list: (number | null | undefined)[]) => { const v = list.filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) : null; };

export function measure(limit: number | null, progress: number | null, fact: number | null): Measure {
  const plan = econPlanCost(limit, progress);
  const d = econDeviation(plan, fact ?? (plan != null ? 0 : null));
  return { limit, plan, fact, dev: d.amount, devPct: d.pct, status: fact == null ? 'none' : econStatus(d.pct) };
}

export function analyse(budget: EconBudget, articles: EconArticle[], ov: EconOverview | undefined): BudgetAnalysis {
  const direct = articles.filter((a) => !econIsCompanyKind(a.kind));
  const row = ov?.budgets.find((x) => x.budgetId === budget.id);
  // готовность на конец выбранного месяца (срез дашборда), без обзора — последняя
  const res = ov?.results.find((x) => x.budgetId === budget.id);
  const progress = ov ? (res?.progress ?? null) : budget.progress;
  const byArticle = new Map<number, Measure>();
  for (const a of direct) {
    const limit = budget.limits.find((l) => l.articleId === a.id)?.value ?? null;
    const fact = row?.facts[a.id] ?? null;
    if (limit == null && fact == null) continue;
    byArticle.set(a.id, measure(limit, progress, fact));
  }
  const limit = sum([...byArticle.values()].map((m) => m.limit));
  const fact = row ? (sum(direct.map((a) => row.facts[a.id])) ?? 0) : null;
  return {
    b: budget,
    progress,
    res,
    direct: measure(limit, progress, fact),
    spentPct: limit && fact != null ? fact / limit : null,
    forecast: econForecast(limit, fact, progress),
    byArticle,
    labor: measure(budget.laborHoursNorm, progress, row?.laborHours ?? null),
    machine: measure(budget.machineHoursNorm, progress, row?.machineHours ?? null),
    months: row?.months ?? 0,
  };
}

/**
 * Итог по набору центров затрат. План, факт и отклонение — только по центрам, где известны и план (лимит × готовность),
 * и факт: иначе факт без плана (нет готовности) или план без факта (не внесён) исказили бы итог.
 */
export function total(list: BudgetAnalysis[]) {
  const withLimits = list.filter((x) => x.direct.limit);
  const comparable = withLimits.filter((x) => x.direct.plan != null && x.direct.fact != null);
  const limit = sum(withLimits.map((x) => x.direct.limit));
  const compLimit = sum(comparable.map((x) => x.direct.limit));
  const plan = sum(comparable.map((x) => x.direct.plan));
  const fact = sum(comparable.map((x) => x.direct.fact));
  const d = econDeviation(plan, fact);
  const cost = sum(withLimits.map((x) => x.b.costBase));
  const withForecast = list.filter((x) => x.forecast?.result != null);
  return {
    limit,
    plan,
    fact,
    dev: d.amount,
    devPct: d.pct,
    status: fact == null ? ('none' as const) : econStatus(d.pct),
    progress: plan != null && compLimit ? plan / compLimit : null,
    spentPct: compLimit && fact != null ? fact / compLimit : null,
    cost,
    /** сколько центров затрат вошло в сравнение план–факт и сколько с лимитами всего */
    compared: comparable.length,
    withLimits: withLimits.length,
    forecast: withForecast.length ? sum(withForecast.map((x) => x.forecast!.result)) : null,
    forecastCount: withForecast.length,
  };
}

/**
 * Доходы и расходы центра затрат нарастающим итогом (как часть 2 таблицы ПЭО). План — на выполненный объём:
 * выручка = стоимость × готовность, расходы = лимит × готовность. Факт: выручка = КС-2 + НЗП, прямые — факт ПЭО,
 * общепроизводственные и административные — общие расходы компании, разнесённые по доле выручки.
 */
export interface PnL {
  revenuePlan: number | null;
  revenueSchedule: number | null;
  revenue: number | null;
  ks: number | null;
  nzp: number | null;
  direct: Map<number, { plan: number | null; fact: number | null }>;
  company: Map<number, { plan: number | null; fact: number | null }>;
  directPlan: number | null;
  directFact: number | null;
  marginPlan: number | null;
  margin: number | null;
  companyPlan: number | null;
  companyFact: number | null;
  profitPlan: number | null;
  profit: number | null;
  laborPlan: number | null;
  labor: number | null;
  machinePlan: number | null;
  machine: number | null;
}

const minus = (a: number | null, b: number | null) => (a == null ? null : a - (b ?? 0));

export function pnl(x: BudgetAnalysis, articles: EconArticle[], ov: EconOverview | undefined): PnL {
  const row = ov?.budgets.find((r) => r.budgetId === x.b.id);
  const base = x.res?.costBase ?? x.b.costBase;
  const revenuePlan = econPlanCost(base, x.progress);
  const direct = new Map<number, { plan: number | null; fact: number | null }>();
  const company = new Map<number, { plan: number | null; fact: number | null }>();
  for (const a of articles) {
    const limit = x.b.limits.find((l) => l.articleId === a.id)?.value ?? null;
    const plan = econPlanCost(limit, x.progress);
    if (econIsCompanyKind(a.kind)) {
      const fact = x.res?.distributed[a.id] ?? null;
      if (plan != null || fact != null) company.set(a.id, { plan, fact });
    } else {
      const fact = row?.facts[a.id] ?? null;
      if (plan != null || fact != null) direct.set(a.id, { plan, fact });
    }
  }
  const directPlan = sum([...direct.values()].map((v) => v.plan));
  const directFact = sum([...direct.values()].map((v) => v.fact));
  const companyPlan = sum([...company.values()].map((v) => v.plan));
  const companyFact = sum([...company.values()].map((v) => v.fact));
  const revenue = x.res?.revenue ?? null;
  const margin = minus(revenue, directFact);
  const marginPlan = minus(revenuePlan, directPlan);
  return {
    revenuePlan,
    revenueSchedule: econPlanCost(base, x.res?.planProgress ?? null),
    revenue,
    ks: x.res?.ks ?? null,
    nzp: x.res?.nzp ?? null,
    direct,
    company,
    directPlan,
    directFact,
    marginPlan,
    margin,
    companyPlan,
    companyFact,
    profitPlan: minus(marginPlan, companyPlan),
    profit: minus(margin, companyFact),
    laborPlan: x.labor.plan,
    labor: x.labor.fact,
    machinePlan: x.machine.plan,
    machine: x.machine.fact,
  };
}

/** Сумма отчётов о доходах и расходах (по направлению или всей программе). */
export function sumPnl(list: PnL[]): PnL {
  const s = (f: (p: PnL) => number | null) => sum(list.map(f));
  const merge = (key: 'direct' | 'company') => {
    const m = new Map<number, { plan: number | null; fact: number | null }>();
    for (const p of list)
      for (const [id, v] of p[key]) {
        const cur = m.get(id) ?? { plan: null, fact: null };
        m.set(id, { plan: sum([cur.plan, v.plan]), fact: sum([cur.fact, v.fact]) });
      }
    return m;
  };
  return {
    revenuePlan: s((p) => p.revenuePlan),
    revenueSchedule: s((p) => p.revenueSchedule),
    revenue: s((p) => p.revenue),
    ks: s((p) => p.ks),
    nzp: s((p) => p.nzp),
    direct: merge('direct'),
    company: merge('company'),
    directPlan: s((p) => p.directPlan),
    directFact: s((p) => p.directFact),
    marginPlan: s((p) => p.marginPlan),
    margin: s((p) => p.margin),
    companyPlan: s((p) => p.companyPlan),
    companyFact: s((p) => p.companyFact),
    profitPlan: s((p) => p.profitPlan),
    profit: s((p) => p.profit),
    laborPlan: s((p) => p.laborPlan),
    labor: s((p) => p.labor),
    machinePlan: s((p) => p.machinePlan),
    machine: s((p) => p.machine),
  };
}
