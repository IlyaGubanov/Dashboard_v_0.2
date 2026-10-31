/**
 * Сравнение факта ПЭО с планом затрат на выполненный объём (лимит × готовность работ из дашборда).
 * Прямые статьи сравниваются по каждому центру затрат; общепроизводственные и административные —
 * после разнесения по выручке (этап 2), здесь они только в структуре лимита и в помесячных расходах.
 */
import { econDeviation, econForecast, econIsCompanyKind, econPlanCost, econStatus, type EconArticle, type EconBudget, type EconOverview, type EconStatus } from '@mvs/shared';

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
  const progress = budget.progress;
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
