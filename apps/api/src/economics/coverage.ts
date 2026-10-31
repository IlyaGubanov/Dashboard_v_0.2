import type { EconScope } from '@mvs/shared';

interface BudgetScope { scope: EconScope; sectionId: number | null; siteId: number | null; isArchived: boolean }

/**
 * Какие объекты покрывает центр затрат: объект — сам себя; лот — объекты лота без своего бюджета;
 * направление — объекты без своего бюджета и вне лотов со своим бюджетом. Архивные бюджеты не учитываются.
 */
export function econCoveredSites<S extends { id: number; sectionId: number | null }>(b: BudgetScope, all: BudgetScope[], sites: S[]): S[] {
  const live = all.filter((x) => !x.isArchived);
  const ownSites = new Set(live.filter((x) => x.scope === 'SITE').map((x) => x.siteId));
  const ownSections = new Set(live.filter((x) => x.scope === 'SECTION').map((x) => x.sectionId));
  if (b.scope === 'SITE') return sites.filter((s) => s.id === b.siteId);
  if (b.scope === 'SECTION') return sites.filter((s) => s.sectionId === b.sectionId && !ownSites.has(s.id));
  return sites.filter((s) => !ownSites.has(s.id) && !(s.sectionId != null && ownSections.has(s.sectionId)));
}
