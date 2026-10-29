/**
 * Данные направления в виде, удобном для расчёта: числа вместо Decimal, даты — миллисекунды (UTC-полночь),
 * факт позиции — список записей по отчётным точкам по возрастанию даты.
 */
import type { MoneySource, PeriodKind, PeriodStatus, PlanMethod, ProgressMethod } from '@prisma/client';

export interface KEntry {
  periodId: number;
  date: number;
  statusCode: string | null;
  countsAsDone: boolean;
  exclude: boolean;
  pct: number | null;
  factQty: number | null;
  ks: number | null;
  paid: number | null;
  /** проектный объём на дату отчёта (Благоустройство: может меняться от отчёта к отчёту) */
  p: number | null;
  isExample: boolean;
  enteredById: number | null;
  enteredAt: number | null;
}

export interface KItem {
  id: number;
  workTypeId: number;
  unit: string | null;
  planQty: number | null;
  planCost: number | null;
  planStart: number | null;
  planEnd: number | null;
  /** вес вида работ */
  weight: number | null;
  isExample: boolean;
  entries: KEntry[];
}

export interface KReport {
  periodId: number;
  date: number;
  workers: number | null;
  workersBlocked: number | null;
  machines: number | null;
  machinesBlocked: number | null;
  ks: number | null;
  advance: number | null;
  paid: number | null;
  statusText: string | null;
  remarks: number | null;
}

export interface KSite {
  id: number;
  code: string;
  num: number | null;
  name: string;
  shortName: string;
  section: { id: number; name: string } | null;
  status: { code: string; name: string; color: string | null } | null;
  planStart: number | null;
  planEnd: number | null;
  limit: number | null;
  contracts: { amount: number | null; advance: number | null }[];
  items: KItem[];
  reports: KReport[];
  curators: string[];
  entry: string[];
  lat: number | null;
  lon: number | null;
  isExample: boolean;
  /** замечания: когда созданы, когда закрыты (принято / снято), срок */
  remarkLog?: { created: number; closed: number | null; due: number | null }[];
}

export interface KPeriod {
  id: number;
  date: number;
  status: PeriodStatus;
  program: string;
  label: string | null;
}

export interface KTrackerRow {
  siteId: number;
  planDate: number | null;
  dueDate: number | null;
  /** по коду этапа */
  values: Record<string, { num: number | null; text: string | null; bool: boolean | null; date: number | null }>;
}

export interface KTracker {
  code: string;
  stages: { code: string; options: { value: string; done?: boolean }[] }[];
  rows: KTrackerRow[];
}

/** Настройка дополнительного показателя: какая метрика, подпись, параметры. */
export interface KpiTileConfig {
  metric: string;
  label: string;
  params?: Record<string, unknown>;
}

export interface KDirection {
  id: number;
  code: string;
  name: string;
  shortName: string;
  isReadonly: boolean;
  periodKind: PeriodKind;
  planWeekday: number;
  progressMethod: ProgressMethod;
  planMethod: PlanMethod;
  moneySource: MoneySource;
  moneyLabel: string | null;
  thrWarn: number;
  thrCrit: number;
  siteUnit: string;
  settings: { kpis?: KpiTileConfig[]; programs?: Record<string, string>; factLabel?: string };
  periods: KPeriod[];
  sites: KSite[];
  trackers: KTracker[];
}

export const DAY_MS = 86_400_000;
export const toMs = (d: Date | null | undefined) => (d ? d.getTime() : null);
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const parseDate = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
