export const ECON_TABS = ['overview', 'pnl', 'cash', 'limits', 'fact', 'articles', 'journal'] as const;
export type EconTab = (typeof ECON_TABS)[number];
export interface EconomicsSearch { tab?: EconTab; month?: string; dir?: number; archive?: boolean; year?: number; cash?: 'entry'; scope?: string }
export function parseEconomicsSearch(s: Record<string, unknown>): EconomicsSearch {
  const dir = Number(s.dir);
  return {
    tab: ECON_TABS.includes(s.tab as EconTab) ? (s.tab as EconTab) : undefined,
    month: typeof s.month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s.month) ? s.month : undefined,
    dir: Number.isSafeInteger(dir) && dir > 0 ? dir : undefined,
    archive: s.archive === true || s.archive === 'true' || undefined,
    year: Number.isInteger(Number(s.year)) && Number(s.year) >= 2020 && Number(s.year) <= 2099 ? Number(s.year) : undefined,
    cash: s.cash === 'entry' ? 'entry' : undefined,
    scope: typeof s.scope === 'string' && /^(C|D\d{1,9})$/.test(s.scope) ? s.scope : undefined,
  };
}
