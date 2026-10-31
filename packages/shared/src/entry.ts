import { z } from 'zod';
import type { PeriodKind } from './directions';
import type { ReportSummary } from './report-summary';

const money = z.number().min(0, 'Не может быть отрицательным').max(1e13).nullable().optional();
const count = z.number().int('Целое число').min(0, 'Не может быть отрицательным').max(100_000).nullable().optional();
const version = z.number().int().positive().optional();

/** Факт по позиции за отчётную точку. version — версия, которую видел пользователь (нет — записи ещё не было). */
export const entryItemSchema = z.object({
  workItemId: z.number().int().positive(),
  statusCode: z.string().max(32).nullable().optional(),
  pct: z.number().min(0, 'От 0 до 100').max(100, 'От 0 до 100').nullable().optional(),
  factQty: z.number().min(0, 'Не может быть отрицательным').max(1e12).nullable().optional(),
  ks: money,
  paid: money,
  note: z.string().trim().max(1000).nullable().optional(),
  version,
});

/** Показатели объекта за отчётную точку: люди, техника, деньги на уровне объекта. */
export const entryReportSchema = z.object({
  siteId: z.number().int().positive(),
  workers: count,
  machines: count,
  statusText: z.string().trim().max(200).nullable().optional(),
  remarksCount: count,
  workersBlocked: count,
  machinesBlocked: count,
  ks: money,
  paid: money,
  note: z.string().trim().max(1000).nullable().optional(),
  version,
});

export const entrySaveSchema = z.object({
  items: z.array(entryItemSchema).max(5000).default([]),
  reports: z.array(entryReportSchema).max(2000).default([]),
});
export type EntryItemInput = z.infer<typeof entryItemSchema>;
export type EntryReportInput = z.infer<typeof entryReportSchema>;
export type EntrySaveInput = z.input<typeof entrySaveSchema>;
export type EntrySaveData = z.output<typeof entrySaveSchema>;

export const periodCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
  program: z.string().max(32).optional(),
});
export const periodStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'LOCKED']),
  comment: z.string().trim().max(500).optional(),
});

export interface EntryValue {
  statusCode: string | null;
  pct: number | null;
  factQty: number | null;
  ks: number | null;
  paid: number | null;
  note: string | null;
}

export interface EntryReportValue {
  statusText: string | null;
  remarksCount: number | null;
  workers: number | null;
  machines: number | null;
  workersBlocked: number | null;
  machinesBlocked: number | null;
  ks: number | null;
  paid: number | null;
  note: string | null;
}

/** Лист ввода за отчётную точку: действующие значения (свои или перенесённые с прошлых точек) и права. */
export interface EntrySheet {
  aggregate?: { version: number; value: ReportSummary | null; canEdit: boolean };
  direction: { code: string; name: string; periodKind: PeriodKind };
  period: { id: number; date: string; status: 'OPEN' | 'CLOSED' | 'LOCKED'; label: string | null; program: string };
  permissions: {
    /** роль пользователя в направлении (ADMIN — администратор) */
    role: string | null;
    /** можно вносить при текущем статусе точки хотя бы по одному объекту */
    canEdit: boolean;
    canClose: boolean;
    canReopen: boolean;
    canLock: boolean;
    canOpenNew: boolean;
    /** почему ввод закрыт */
    reason: string | null;
  };
  fields: {
    reportStatus: boolean;
    reportRemarks: boolean;
    status: boolean;
    pct: boolean;
    factQty: boolean;
    ks: boolean;
    paid: boolean;
    workers: boolean;
    blocked: boolean;
    reportKs: boolean;
    reportPaid: boolean;
  };
  statuses: { code: string; name: string; color: string | null; countsAsDone: boolean; excludeFromCalc: boolean }[];
  sites: {
    id: number;
    name: string;
    section: string | null;
    canEdit: boolean;
    /** пользователь назначен на объект (ввод / куратор) */
    mine: boolean;
    /** по объекту уже что-то внесено в эту точку */
    updated: boolean;
    report: { value: EntryReportValue; version: number | null; from: string | null };
    items: {
      id: number;
      name: string;
      group: string | null;
      unit: string | null;
      planQty: number | null;
      planCost: number | null;
      planStart: string | null;
      planEnd: string | null;
      value: EntryValue;
      /** версия записи этой точки; null — записи нет, показано значение с прошлой точки */
      version: number | null;
      /** дата точки, с которой взято значение */
      from: string | null;
      enteredBy: string | null;
      enteredAt: string | null;
    }[];
  }[];
}

export interface EntrySaveResult {
  savedItems: number;
  savedReports: number;
  unchanged: number;
}

/** Запись журнала изменений. */
export interface AuditRow {
  id: string;
  at: string;
  user: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  site: string | null;
  comment: string | null;
  changes: { field: string; before: unknown; after: unknown }[];
}

export interface AuditPage {
  total: number;
  rows: AuditRow[];
}
