export interface StaffingSearch { month?: string; compare?: string; q?: string; category?: string; status?: string; sort?: string; tab?: string; archive?: boolean }
export function parseStaffingSearch(s: Record<string, unknown>): StaffingSearch {
  const month = (v: unknown) => typeof v === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined;
  return { month: month(s.month), compare: month(s.compare), q: typeof s.q === 'string' ? s.q.slice(0, 300) : undefined,
    category: ['АУП', 'ВП', 'ОП'].includes(String(s.category)) ? String(s.category) : undefined,
    status: ['vacant', 'excess', 'missing', 'archived'].includes(String(s.status)) ? String(s.status) : undefined,
    sort: ['name', 'actual', 'planned', 'vacancies'].includes(String(s.sort)) ? String(s.sort) : undefined,
    tab: ['overview', 'departments', 'payroll', 'journal'].includes(String(s.tab)) ? String(s.tab) : undefined,
    archive: s.archive === true || s.archive === 'true' || undefined };
}
