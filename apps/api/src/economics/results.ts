/**
 * Результат центров затрат на конец месяца (этап 2): срез дашборда на последний день месяца — готовность факт и по графику,
 * стоимость, КС-2; КС-2 ПЭО (если внесены); НЗП = выполнено − КС-2 (или поправка ПЭО); выручка = КС-2 + НЗП;
 * общие расходы компании нарастающим итогом разносятся по доле выручки центра во всей производственной программе.
 * Считается по всем действующим центрам затрат (база разнесения общая); права фильтрует вызывающий.
 */
import { econDistribute, econIsCompanyKind, econMonthEnd, econNet, econNzp, econRevenue, type EconResult } from '@mvs/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { KpiService } from '../kpi/kpi.service';
import { econCoveredSites } from './coverage';

export interface ResultRow extends EconResult {
  /** КС-2 из дашборда нарастающим итогом без НДС (для подсказки «КС-2 за месяц») */
  ksDash: number | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function computeResults(prisma: PrismaService, kpi: KpiService, month: string, vatRate: number) {
  const end = econMonthEnd(month);
  // текущий месяц и будущее — по последнему срезу дашборда
  const today = new Date().toISOString().slice(0, 10);
  const date = end >= today ? undefined : end;
  const [budgets, sites, rows, manualIds, company, articles] = await Promise.all([
    prisma.econBudget.findMany({ where: { isArchived: false, direction: { isActive: true } }, select: { id: true, directionId: true, scope: true, sectionId: true, siteId: true, isArchived: true, costNet: true, vatExempt: true } }),
    prisma.site.findMany({ where: { isArchived: false, direction: { isActive: true } }, select: { id: true, directionId: true, sectionId: true } }),
    prisma.econBudgetMonth.findMany({ where: { month: { lte: month } }, select: { budgetId: true, month: true, ksAmount: true, nzpOverride: true, nzpNote: true } }),
    prisma.econBudgetMonth.findMany({ where: { ksAmount: { not: null } }, select: { budgetId: true }, distinct: ['budgetId'] }),
    prisma.econCompanyFact.findMany({ where: { month: { lte: month } } }),
    prisma.econArticle.findMany({ select: { id: true, kind: true } }),
  ]);
  const manual = new Set(manualIds.map((r) => r.budgetId));
  const results = new Map<number, ResultRow>();
  for (const directionId of new Set(budgets.map((b) => b.directionId))) {
    const own = budgets.filter((b) => b.directionId === directionId);
    const dirSites = sites.filter((s) => s.directionId === directionId);
    const money = await kpi.siteMoney(directionId, date);
    for (const b of own) {
      const m = econCoveredSites(b, own, dirSites).map((s) => money.get(s.id)).filter((x): x is NonNullable<typeof x> => !!x);
      const weighted = (f: (x: (typeof m)[number]) => number | null) => {
        const w = m.filter((x) => f(x) != null && x.portfolio);
        if (w.length) return w.reduce((a, x) => a + f(x)! * x.portfolio!, 0) / w.reduce((a, x) => a + x.portfolio!, 0);
        const all = m.filter((x) => f(x) != null);
        return all.length ? all.reduce((a, x) => a + f(x)!, 0) / all.length : null;
      };
      const total = (f: (x: (typeof m)[number]) => number | null) => { const v = m.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) : null; };
      const vat = (v: number | null) => econNet(v, vatRate, b.vatExempt);
      const costBase = b.costNet != null ? Number(b.costNet) : vat(total((x) => x.portfolio));
      const progress = weighted((x) => x.fact);
      const ksDash = vat(total((x) => x.closed));
      const own2 = rows.filter((r) => r.budgetId === b.id);
      const ks = manual.has(b.id) ? round2(own2.reduce((a, r) => a + Number(r.ksAmount ?? 0), 0)) : ksDash;
      const nzpAuto = econNzp(costBase, progress, ks);
      const override = own2.find((r) => r.month === month && r.nzpOverride != null);
      const nzp = override ? Number(override.nzpOverride) : nzpAuto;
      results.set(b.id, {
        budgetId: b.id,
        progress: progress == null ? null : Math.round(progress * 10000) / 10000,
        planProgress: (() => { const v = weighted((x) => x.plan); return v == null ? null : Math.round(v * 10000) / 10000; })(),
        costBase,
        ks,
        ksDash,
        ksSource: manual.has(b.id) ? 'manual' : ksDash != null ? 'dashboard' : null,
        nzpAuto,
        nzp,
        nzpNote: override?.nzpNote ?? null,
        revenue: econRevenue(ks, nzp),
        revenueShare: null,
        distributed: {},
      });
    }
  }
  // разнесение общих расходов по доле выручки (отрицательная выручка в базу не входит)
  const programRevenue = [...results.values()].reduce((a, r) => a + Math.max(0, r.revenue ?? 0), 0) || null;
  const companyKinds = new Set(articles.filter((a) => econIsCompanyKind(a.kind)).map((a) => a.id));
  const companyTotals = new Map<number, number>();
  for (const c of company) if (companyKinds.has(c.articleId)) companyTotals.set(c.articleId, (companyTotals.get(c.articleId) ?? 0) + Number(c.amount));
  for (const r of results.values()) {
    r.revenueShare = programRevenue && r.revenue != null ? Math.max(0, r.revenue) / programRevenue : null;
    for (const [articleId, sum] of companyTotals) {
      const v = econDistribute(sum, r.revenue, programRevenue);
      if (v != null) r.distributed[articleId] = v;
    }
  }
  return { results, programRevenue: programRevenue == null ? null : round2(programRevenue), asOf: date ?? today };
}
