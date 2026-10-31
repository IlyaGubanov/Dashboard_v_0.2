export const ECON_TABS = ['overview', 'limits', 'fact', 'articles', 'journal'] as const;
export type EconTab = (typeof ECON_TABS)[number];
export interface EconomicsSearch { tab?: EconTab; month?: string; dir?: number; archive?: boolean }
export function parseEconomicsSearch(s: Record<string, unknown>): EconomicsSearch {
  const dir = Number(s.dir);
  return {
    tab: ECON_TABS.includes(s.tab as EconTab) ? (s.tab as EconTab) : undefined,
    month: typeof s.month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s.month) ? s.month : undefined,
    dir: Number.isSafeInteger(dir) && dir > 0 ? dir : undefined,
    archive: s.archive === true || s.archive === 'true' || undefined,
  };
}
