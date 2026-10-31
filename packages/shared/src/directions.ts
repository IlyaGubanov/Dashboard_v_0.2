import type { MemberRole } from './auth';

export const PERIOD_KINDS = ['DAY', 'WEEK', 'REPORT'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  DAY: 'По дням',
  WEEK: 'Отчётные недели',
  REPORT: 'По отчётам',
};

export const PROGRESS_METHODS = [
  'WEIGHTED_BY_COST',
  'WEIGHTED_BY_WORK_WEIGHT',
  'SHARE_COMPLETED',
  'SIMPLE_AVERAGE',
] as const;
export type ProgressMethod = (typeof PROGRESS_METHODS)[number];

export const PROGRESS_METHOD_LABELS: Record<ProgressMethod, string> = {
  WEIGHTED_BY_COST: 'Взвешенно по стоимости позиций',
  WEIGHTED_BY_WORK_WEIGHT: 'Взвешенно по весам видов работ',
  SHARE_COMPLETED: 'Доля позиций с выполненным объёмом',
  SIMPLE_AVERAGE: 'Среднее по позициям',
};

/** Карточка направления для меню и сводки. */
/** Плитка на вкладке «Обзор» направления: показывать ли, подпись (пусто — стандартная), свой цвет. */
export interface OverviewTileConfig {
  key: string;
  hidden: boolean;
  label: string;
  color: string | null;
}

export interface DirectionSummary {
  id: number;
  code: string;
  name: string;
  shortName: string;
  icon: string | null;
  color: string | null;
  periodKind: PeriodKind;
  isReadonly: boolean;
  siteUnit: string;
  sitesCount: number;
  /** плитки вкладки «Обзор»: порядок и вид (конструктор → «Плитки обзора») */
  overviewTiles: OverviewTileConfig[];
  sections: { id: number; name: string }[];
  curators: { id: number; fullName: string }[];
  /** роль текущего пользователя (null — доступ через глобальную роль) */
  myRole: MemberRole | null;
}

/** Светофор направления/объекта по отклонению факт − план (в п.п.). */
export type RiskLevel = 'ok' | 'warn' | 'crit' | 'na';

export function riskLevel(deviationPp: number | null, thrWarn: number, thrCrit: number): RiskLevel {
  if (deviationPp == null || Number.isNaN(deviationPp)) return 'na';
  if (deviationPp < thrCrit) return 'crit';
  if (deviationPp < thrWarn) return 'warn';
  return 'ok';
}
