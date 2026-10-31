import type { PeriodKind, RiskLevel } from './directions';

/** Состояние объекта относительно графика. */
export type SiteRisk = 'done' | 'wait' | 'ok' | 'warn' | 'crit' | 'na';

export const SITE_RISK_LABELS: Record<SiteRisk, string> = {
  done: 'Выполнено',
  wait: 'Не начато по графику',
  ok: 'В графике',
  warn: 'Отставание',
  crit: 'Критично',
  na: 'Нет графика',
};

export type KpiFormat = 'money' | 'int' | 'qty' | 'days' | 'percent';

/** Дополнительный показатель направления (набор задаётся в настройках направления). */
export interface KpiTile {
  key: string;
  label: string;
  value: number | null;
  format: KpiFormat;
  unit?: string;
  /** «из N» — для показателей вида «4 из 4» */
  of?: number;
}

export interface KpiAttention {
  siteId: number;
  code: string;
  name: string;
  section: string | null;
  fact: number | null;
  plan: number | null;
  /** отклонение факт − план (доля, −0.12 = −12 п.п.) */
  d: number;
  crit: boolean;
}

export interface KpiRemarkRow {
  siteId: number;
  name: string;
  status: string | null;
  n: number;
  /** позиций с невыполненным проектным объёмом */
  open: number;
}

/** Показатели направления на отчётную точку — то, что видит руководство в сводке. */
/**
 * Прогноз завершения по темпу последних ~4 недель.
 *   done — выполнено; ontime / late — успевает / опаздывает к плановому окончанию; noplan — дата есть, плана нет;
 *   stalled — темпа нет (работы стоят); nodata — мало истории.
 */
export interface Forecast {
  status: 'done' | 'ontime' | 'late' | 'stalled' | 'noplan' | 'nodata';
  date: string | null;
  /** на сколько дней позже плана (минус — раньше) */
  delayDays: number | null;
  /** темп: прирост готовности за неделю, доля */
  pacePerWeek: number | null;
  /** с какой даты считается темп */
  since: string | null;
  planEnd: string | null;
}

/** Физические объёмы сетей по способу прокладки на отчётную точку. */
export interface NetworkLayingKpi {
  code: 'open' | 'closed';
  /** Объекты с хотя бы одной неисключённой позицией этого вида. */
  sites: number;
  /** Погонные метры; null, если хотя бы у одной позиции нет объёма. */
  planQty: number | null;
  factQty: number | null;
  /** Σ факт / Σ проект; null при неполных данных или нулевом проекте. */
  fact: number | null;
}

export interface DirectionKpi {
  code: string;
  asOf: string | null;
  asOfKind: PeriodKind;
  periodId: number | null;
  periodStatus: 'OPEN' | 'CLOSED' | 'LOCKED' | null;
  /** данные отчётной точки проверены куратором (период закрыт) */
  verified: boolean;
  /** дата, на которую посчитан план */
  planDate: string | null;
  sites: number;
  siteUnit: string;
  lagging: number | null;
  critical: number | null;
  done: number | null;
  fact: number | null;
  plan: number | null;
  factLabel: string;
  /** светофор направления в сводке (по порогам сводки) */
  risk: RiskLevel;
  prev: { asOf: string; fact: number | null; plan: number | null } | null;
  people: number | null;
  tech: number | null;
  money: { portfolio: number | null; portfolioLabel: string; closed: number | null; paid: number | null } | null;
  kpis: KpiTile[];
  /** Только для направления «Сети»: открытая и закрытая прокладка. */
  networkLaying?: NetworkLayingKpi[];
  attention: KpiAttention[];
  /** прогноз завершения направления и сколько объектов по прогнозу не успевают */
  forecast: Forecast | null;
  forecastLate: number | null;
  remarks?: KpiRemarkRow[];
  /** другие программы отчёта (Благоустройство: текущий ремонт) */
  extra?: { label: string; sites: number; asOf: string }[];
  /** в данных есть значения-примеры */
  hasExamples: boolean;
}

/** Строка реестра объектов. */
export interface SiteKpiRow {
  id: number;
  code: string;
  num: number | null;
  name: string;
  shortName: string;
  section: { id: number; name: string } | null;
  status: { code: string; name: string; color: string | null } | null;
  statusText: string | null;
  fact: number | null;
  plan: number | null;
  lag: number | null;
  risk: SiteRisk;
  planStart: string | null;
  planEnd: string | null;
  money: { portfolio: number | null; closed: number | null; paid: number | null };
  people: number | null;
  tech: number | null;
  remarks: number | null;
  /** замечаний не закрыто / из них просрочено (на дату среза) */
  remarksOpen: number;
  remarksOverdue: number;
  forecast: Forecast | null;
  overdueItems: number;
  curators: string[];
  entry: string[];
  /** подрядчик объекта */
  contractor: { id: number; name: string } | null;
  /** подрядчики отдельных позиций (кроме подрядчика объекта) */
  subcontractors: { id: number; name: string }[];
  lat: number | null;
  lon: number | null;
  isExample: boolean;
}

export interface OverviewDirection {
  id: number;
  code: string;
  name: string;
  shortName: string;
  icon: string | null;
  color: string | null;
  isReadonly: boolean;
  curators: { id: number; fullName: string }[];
  kpi: DirectionKpi;
}

export interface Overview {
  thresholds: { warn: number; crit: number };
  directions: OverviewDirection[];
}

export interface PeriodItem {
  id: number;
  date: string;
  program: string;
  label: string | null;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
}

/** Точка динамики направления или объекта. */
export interface DynamicsPoint {
  date: string;
  label: string | null;
  verified: boolean;
  fact: number | null;
  plan: number | null;
  people: number | null;
  tech: number | null;
  closed: number | null;
  paid: number | null;
}

export interface SiteCardItem {
  id: number;
  code: string;
  name: string;
  group: string | null;
  unit: string | null;
  planQty: number | null;
  planCost: number | null;
  planStart: string | null;
  planEnd: string | null;
  weight: number | null;
  responsible: string | null;
  contractor: string | null;
  fact: number;
  factQty: number | null;
  plan: number | null;
  excluded: boolean;
  overdue: boolean;
  status: { code: string; name: string; color: string | null } | null;
  ks: number | null;
  paid: number | null;
  /** когда и кем внесён действующий факт */
  enteredAt: string | null;
  enteredBy: string | null;
  asOf: string | null;
  isExample: boolean;
}

export interface SiteCardField {
  code: string;
  label: string;
  type: string;
  unit: string | null;
  group: string | null;
  value: unknown;
  options: { value: string; label: string; color?: string }[] | null;
}

export interface SiteCardTracker {
  code: string;
  name: string;
  layout: 'MATRIX' | 'CARD';
  stages: { code: string; name: string; valueType: string; options: { value: string; label: string; color?: string; done?: boolean }[] | null }[];
  rows: {
    item: { code: string; name: string; category: string | null };
    qty: number | null;
    unit: string | null;
    planDate: string | null;
    dueDate: string | null;
    attrs: Record<string, unknown> | null;
    values: Record<string, string | number | boolean | null>;
  }[];
}

/** Карточка объекта. */
export interface SiteCard {
  row: SiteKpiRow;
  address: string | null;
  okrug: string | null;
  district: string | null;
  note: string | null;
  contractor: string | null;
  designer: string | null;
  limit: number | null;
  asOf: string | null;
  fields: SiteCardField[];
  assignments: { role: string; fullName: string; position: string | null; phone: string | null; email: string | null }[];
  items: SiteCardItem[];
  contracts: { number: string | null; signedAt: string | null; endAt: string | null; amount: number | null; advance: number | null; organization: string | null }[];
  history: DynamicsPoint[];
  trackers: SiteCardTracker[];
  /** текущий пользователь может вносить данные по объекту (надстройки) */
  canEdit: boolean;
  /** текущий пользователь может менять объект, позиции, ответственных */
  canManage: boolean;
}

/** Позиции всех объектов на дату — для матрицы «объект × вид работ» и графика работ. */
export interface WorkGrid {
  asOf: string | null;
  planDate: string | null;
  workTypes: { id: number; code: string; name: string; group: string | null; unit: string | null }[];
  sites: {
    id: number;
    name: string;
    section: string | null;
    risk: SiteRisk;
    fact: number | null;
    plan: number | null;
    start: string | null;
    end: string | null;
    items: {
      id: number;
      workTypeId: number;
      name: string;
      start: string | null;
      end: string | null;
      fact: number;
      plan: number | null;
      excluded: boolean;
      overdue: boolean;
      status: string | null;
      factQty: number | null;
      planQty: number | null;
      unit: string | null;
    }[];
  }[];
}

/** Надстройки направления по всем объектам. */
export interface TrackersView {
  trackers: (Omit<SiteCardTracker, 'rows'> & {
    items: { code: string; name: string; category: string | null }[];
    rows: (SiteCardTracker['rows'][number] & { siteId: number; siteName: string })[];
  })[];
}

/** Ответственные направления и контроль заполнения. */
export interface PeopleView {
  /** текущая (последняя) отчётная точка */
  currentPeriod: { date: string; status: string } | null;
  people: {
    userId: number;
    fullName: string;
    position: string | null;
    phone: string | null;
    email: string | null;
    canLogin: boolean;
    role: string | null;
    scope: string | null;
    sections: string[];
    assignments: Record<string, number>;
    responsibleItems: number;
    entries: number;
    lastEntryAt: string | null;
    /** внёс данные в текущую отчётную точку */
    enteredCurrent: boolean;
  }[];
}
