import type { ReportProgramSummary } from '@mvs/shared';
import { calculate } from './engine';
import { isoDate, type KDirection, type KPeriod, type KSite } from './model';

/** Раздел задаёт программу; у исторического объекта без такой связи используем его реальные отчёты. */
export function objectReportPeriods(dir: KDirection, site: KSite, until: number): KPeriod[] {
  const periods = dir.periods.filter(p => p.date <= until);
  const ownCode = site.section?.code;
  const matching = ownCode && periods.some(p => p.program === ownCode) ? ownCode : [...periods].reverse().find(p => site.reports.some(r => r.periodId === p.id) || site.items.some(i => i.entries.some(e => e.periodId === p.id)))?.program;
  return matching === undefined ? [] : periods.filter(p => p.program === matching);
}

/** Сопоставляем две действующие методики, не меняя ни одну из них. */
export function reportPrograms(dir: KDirection, until: number): ReportProgramSummary[] {
  const latest = new Map<string, KPeriod>();
  for (const p of dir.periods) if (p.date <= until) latest.set(p.program, p);
  const configured = dir.settings.kpis?.find(k => k.metric === 'reportStatusCount')?.params?.statuses;
  const statuses = Array.isArray(configured) ? configured.map(String) : [];
  return [...latest].map(([code, p]) => {
    const rows = calculate(dir, p).sites.filter(s => s.report || s.items.some(i => i.entry)).map(s => ({
      id: s.site.id, name: s.site.shortName, volumeDone: s.pos ? s.risk === 'done' : null,
      statusDone: s.report?.statusText && statuses.length ? statuses.includes(s.report.statusText) : null,
      statusText: s.report?.statusText ?? null, remarksCount: s.report?.remarks ?? null,
      source: s.report?.source ?? null,
    }));
    return {
      periodId: p.id, code, name: dir.settings.programs?.[code] ?? code, asOf: isoDate(p.date), source: dir.settings.source ?? null, sheet: p.label,
      aggregate: p.summary?.value ?? null,
      volumeDone: rows.filter(s => s.volumeDone).length, volumeTotal: rows.filter(s => s.volumeDone != null).length,
      statusDone: statuses.length ? rows.filter(s => s.statusDone).length : null, statusTotal: rows.filter(s => s.statusDone != null).length,
      volumeMethod: dir.progressMethod === 'SHARE_COMPLETED'
        ? 'Доля позиций, где факт достиг проектного объёма, не ниже 99,5%. Учитываются только позиции с известным положительным проектом. Знаменатель — объекты с такими позициями в этом отчёте.'
        : 'Нормированная готовность по действующей методике направления не ниже 99,5%. Знаменатель — объекты с известными положительными проектными объёмами в этом отчёте.',
      statusMethod: statuses.length ? `Завершённые отчётные статусы: ${statuses.join(', ')}. Знаменатель — объекты с заполненным отчётным статусом.` : 'Завершённые отчётные статусы не настроены.',
      rows,
    };
  });
}
