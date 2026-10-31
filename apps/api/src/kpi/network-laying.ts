import type { NetworkLayingKpi } from '@mvs/shared';
import type { SiteCalc } from './engine';

/** Объёмы на том же срезе, что и KPI: объект может участвовать в обоих способах прокладки. */
export function networkLaying(sites: SiteCalc[]): NetworkLayingKpi[] {
  return (['open', 'closed'] as const).map((code) => {
    const siteIds = new Set<number>();
    const plans: (number | null)[] = [];
    const facts: (number | null)[] = [];
    for (const s of sites) {
      for (const i of s.items) {
        if (i.excluded || i.item.workTypeCode !== code) continue;
        siteIds.add(s.site.id);
        plans.push(i.entry?.p ?? i.item.planQty);
        facts.push(i.entry?.factQty ?? null);
      }
    }
    // Неполные объёмы не подменяем нулями: иначе готовность окажется завышенной или заниженной.
    const completeSum = (xs: (number | null)[]) =>
      xs.length && xs.every((x): x is number => x != null) ? xs.reduce((a, b) => a + b, 0) : null;
    const planQty = completeSum(plans);
    const factQty = completeSum(facts);
    return { code, sites: siteIds.size, planQty, factQty, fact: planQty != null && planQty > 0 && factQty != null ? factQty / planQty : null };
  });
}
