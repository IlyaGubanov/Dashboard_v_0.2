import { z } from 'zod';

export const STAFFING_CATEGORIES = ['АУП', 'ВП', 'ОП'] as const;
export const STAFFING_CATEGORY_LABELS = { АУП: 'Административно-управленческий персонал', ВП: 'Вспомогательный персонал', ОП: 'Основной персонал' };
const quantity = z.number().finite().min(0, 'Значение не может быть отрицательным').max(1_000_000).nullable();
const identity = { id: z.string().min(1).max(80), department: z.string().trim().min(2, 'Укажите подразделение').max(300), category: z.enum(STAFFING_CATEGORIES) };
export const staffingRowSchema = z.object({
  ...identity,
  planned: quantity,
  actual: z.number().int('Факт указывается в целых сотрудниках').min(0).max(1_000_000).nullable(),
  note: z.string().max(2000).default(''), function: z.string().max(10000).default(''), isArchived: z.boolean().default(false),
  /** Группа на диаграмме распределения; пусто — определяется по названию (staffingGroupOf). */
  group: z.string().trim().max(120, 'Название группы — не длиннее 120 символов').optional(),
});
export type StaffingRow = z.infer<typeof staffingRowSchema>;
export const staffingMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Укажите месяц');
const dateSchema = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Некорректная дата');
const uniqueRows = <T extends { id: string }>(rows: T[]) => new Set(rows.map(r => r.id)).size === rows.length;
export const staffingPeriodSchema = z.object({
  month: staffingMonthSchema, asOf: dateSchema, note: z.string().max(3000).default(''), rows: z.array(staffingRowSchema).max(1000).refine(uniqueRows, 'Подразделение указано дважды'),
}).refine(v => v.asOf.slice(0, 7) === v.month, { message: 'Дата среза должна относиться к выбранному месяцу', path: ['asOf'] })
  .refine(v => JSON.stringify(v).length <= 2_000_000, 'Срез слишком большой: сократите описания или число подразделений');
export type StaffingPeriodData = z.infer<typeof staffingPeriodSchema>;
export interface StaffingPeriod extends StaffingPeriodData { version: number; isArchived: boolean; updatedAt: string }
export const staffingPeriodSaveSchema = z.object({ version: z.number().int().positive(), data: staffingPeriodSchema, isArchived: z.boolean().optional() });
export const staffingPayrollSchema = z.object({
  year: z.number().int().min(2020).max(2099), label: z.string().trim().min(2).max(200),
  rows: z.array(z.object({ ...identity, amount: quantity })).max(1000).refine(uniqueRows, 'Подразделение указано дважды'),
});
export type StaffingPayrollData = z.infer<typeof staffingPayrollSchema>;
export interface StaffingPayroll extends StaffingPayrollData { version: number; updatedAt: string }
export const staffingPayrollSaveSchema = z.object({ version: z.number().int().positive(), data: staffingPayrollSchema });
export const staffingEditorsSchema = z.object({ userIds: z.array(z.number().int().positive()).max(200) });
export interface StaffingPermissions { canView: boolean; canEdit: boolean; canManageEditors: boolean }
export interface StaffingView { periods: StaffingPeriod[]; payroll: StaffingPayroll[]; permissions: StaffingPermissions; canExport: boolean; canAudit: boolean; canFinance: boolean }
export interface StaffingEditors { users: { id: number; fullName: string; login: string | null }[]; userIds: number[] }
export interface StaffingAuditItem { id: string; at: string; user: string; action: string; entityId: string | null; comment: string | null }

/** Частичная сумма имеет отдельный счётчик пропусков. Дефицит — только по заполненным парам. */
export function summarizeStaffing(input: StaffingRow[]) {
  const rows = input.filter(r => !r.isArchived);
  const sum = (key: 'planned' | 'actual') => rows.some(r => r[key] !== null) ? Math.round(rows.reduce((s, r) => s + (r[key] ?? 0), 0) * 100) / 100 : null;
  const pairs = rows.filter(r => r.planned !== null && r.actual !== null);
  const round = (v: number) => Math.round(v * 100) / 100;
  const comparablePlanned = pairs.reduce((s, r) => s + r.planned!, 0);
  const comparableActual = pairs.reduce((s, r) => s + r.actual!, 0);
  const missingPlan = rows.filter(r => r.planned === null).length;
  const missingActual = rows.filter(r => r.actual === null).length;
  return {
    count: rows.length, planned: sum('planned'), actual: sum('actual'), missingPlan, missingActual, paired: pairs.length,
    vacancies: pairs.length ? round(pairs.reduce((s, r) => s + Math.max(0, r.planned! - r.actual!), 0)) : null,
    excess: pairs.length ? round(pairs.reduce((s, r) => s + Math.max(0, r.actual! - r.planned!), 0)) : null,
    netGap: rows.length && !missingPlan && !missingActual ? round(comparablePlanned - comparableActual) : null,
    occupancy: comparablePlanned > 0 ? comparableActual / comparablePlanned : null,
  };
}
/** Блоки как в сводке «СВОД по подразделениям»: РСУ по номеру, затем известные названия, остальное — АУП. */
export const STAFFING_GROUP_OTHER = 'АУП';
const groupHints: [RegExp, string][] = [
  [/эксплуатационная база/i, 'РЭБ (без ТЛС)'],
  [/^(Строительно-монтажное управление|Ремонтно-строительное управление)$|Транспортно-логистическ/i, 'ГУП МВС (СМУ+РСУ+ТЛС)'],
  [/от Учредителя/i, 'РСУ СР+УСР от Учредителя'],
  [/Управление гражданского строительства/i, 'Управление гражданского строительства'],
  [/Управление обеспечения и эксплуатации производственной базы/i, 'Управление обеспечения и эксплуатации производственной базы'],
];
export function staffingGroupOf(row: Pick<StaffingRow, 'department' | 'group'>): string {
  if (row.group?.trim()) return row.group.trim();
  const rsu = row.department.match(/РСУ\s*-?\s*(\d+)/i);
  if (rsu) return `РСУ-${rsu[1]}`;
  return groupHints.find(([re]) => re.test(row.department.trim()))?.[1] ?? STAFFING_GROUP_OTHER;
}
/** Суммы по группам (без архивных строк), от большего факта к меньшему; пропуски не считаются нулём. */
export function staffingGroups(input: StaffingRow[]) {
  const map = new Map<string, StaffingRow[]>();
  for (const r of input.filter(r => !r.isArchived)) map.set(staffingGroupOf(r), [...(map.get(staffingGroupOf(r)) ?? []), r]);
  const size = (v: number | null) => v ?? -1;
  return [...map].map(([group, rows]) => ({ group, ...summarizeStaffing(rows) }))
    .sort((a, b) => size(b.actual) - size(a.actual) || size(b.planned) - size(a.planned) || a.group.localeCompare(b.group, 'ru'));
}
export function staffingDelta(row: StaffingRow, previous: StaffingRow[]): number | null {
  const before = previous.find(r => r.id === row.id && !r.isArchived);
  return row.actual !== null && before?.actual != null ? row.actual - before.actual : null;
}
export function staffingCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^\s*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
