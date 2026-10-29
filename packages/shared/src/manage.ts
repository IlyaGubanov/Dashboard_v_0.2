import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));
const id = z.number().int().positive().nullable().optional();
const amount = z.number().min(0, 'Не может быть отрицательным').max(1e13).nullable().optional();

/** Объект направления. version — для защиты от одновременной правки (обязательна при изменении). */
export const siteSchema = z
  .object({
    name: z.string().trim().min(2, 'Укажите название').max(1000),
    shortName: text(200),
    address: text(500),
    okrug: text(20),
    district: text(100),
    sectionId: id,
    statusCode: z.string().max(32).nullable().optional(),
    planStart: isoDate,
    planEnd: isoDate,
    contractorId: id,
    designerId: id,
    limitAmount: amount,
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    note: text(5000),
    /** значения доп. полей направления: { код поля: значение } */
    attrs: z.record(z.string(), z.unknown()).optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((s) => !s.planStart || !s.planEnd || s.planStart <= s.planEnd, { message: 'Окончание раньше начала', path: ['planEnd'] });
export type SiteInput = z.input<typeof siteSchema>;
export type SiteData = z.output<typeof siteSchema>;

/** Позиция работ на объекте. */
export const workItemSchema = z
  .object({
    workTypeId: z.number().int().positive({ message: 'Выберите вид работ' }),
    label: text(300),
    unit: text(20),
    planQty: z.number().min(0).max(1e12).nullable().optional(),
    planCost: amount,
    planStart: isoDate,
    planEnd: isoDate,
    responsibleId: id,
    contractorId: id,
    note: text(5000),
  })
  .refine((s) => !s.planStart || !s.planEnd || s.planStart <= s.planEnd, { message: 'Окончание раньше начала', path: ['planEnd'] });
export type WorkItemInput = z.input<typeof workItemSchema>;
export type WorkItemData = z.output<typeof workItemSchema>;

export const ASSIGNMENT_ROLES = ['CURATOR', 'ENTRY', 'RESPONSIBLE', 'FOREMAN', 'CHIEF_ENGINEER'] as const;
export const ASSIGNMENT_ROLE_LABELS: Record<(typeof ASSIGNMENT_ROLES)[number], string> = {
  CURATOR: 'Куратор объекта',
  ENTRY: 'Ответственный за ввод',
  RESPONSIBLE: 'Ответственный подрядчика',
  FOREMAN: 'Прораб',
  CHIEF_ENGINEER: 'ГИП',
};
export const assignmentsSchema = z
  .array(z.object({ userId: z.number().int().positive(), role: z.enum(ASSIGNMENT_ROLES) }))
  .max(50);

export const sectionSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(200),
  note: text(500),
  sort: z.number().int().optional(),
});

export const workTypeSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(200),
  group: text(200),
  unit: text(20),
  weight: z.number().min(0).max(1).nullable().optional(),
  planStart: isoDate,
  planEnd: isoDate,
  sort: z.number().int().optional(),
});

export const ORGANIZATION_KINDS = ['CONTRACTOR', 'SUBCONTRACTOR', 'DESIGNER', 'SUPPLIER', 'REVIEWER', 'OTHER'] as const;
export const ORGANIZATION_KIND_LABELS: Record<(typeof ORGANIZATION_KINDS)[number], string> = {
  CONTRACTOR: 'Подрядчик',
  SUBCONTRACTOR: 'Субподрядчик',
  DESIGNER: 'Проектировщик',
  SUPPLIER: 'Поставщик',
  REVIEWER: 'Экспертиза',
  OTHER: 'Другое',
};
export const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Укажите название').max(300),
  kind: z.enum(ORGANIZATION_KINDS),
  inn: z
    .string()
    .trim()
    .regex(/^(\d{10}|\d{12})?$/, 'ИНН — 10 или 12 цифр')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  note: text(2000),
});

/** Строки надстройки по объекту: значения этапов + свои атрибуты строки. */
export const trackerSaveSchema = z.object({
  rows: z
    .array(
      z.object({
        itemCode: z.string().min(1).max(64),
        values: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
        qty: z.number().min(0).nullable().optional(),
        unit: text(20),
        planDate: isoDate,
        dueDate: isoDate,
      }),
    )
    .max(500),
});
export type TrackerSaveInput = z.input<typeof trackerSaveSchema>;
export type TrackerSaveData = z.output<typeof trackerSaveSchema>;

/** Объект для формы редактирования. */
export interface SiteEdit {
  id: number;
  code: string;
  version: number;
  isArchived: boolean;
  name: string;
  shortName: string | null;
  address: string | null;
  okrug: string | null;
  district: string | null;
  sectionId: number | null;
  statusCode: string | null;
  planStart: string | null;
  planEnd: string | null;
  contractorId: number | null;
  designerId: number | null;
  limitAmount: number | null;
  lat: number | null;
  lon: number | null;
  note: string | null;
  attrs: Record<string, unknown>;
  assignments: { userId: number; role: (typeof ASSIGNMENT_ROLES)[number]; fullName: string }[];
  items: {
    id: number;
    workTypeId: number;
    label: string | null;
    unit: string | null;
    planQty: number | null;
    planCost: number | null;
    planStart: string | null;
    planEnd: string | null;
    responsibleId: number | null;
    contractorId: number | null;
    note: string | null;
    isArchived: boolean;
    /** есть внесённый факт — позицию можно только в архив, не удалить */
    hasProgress: boolean;
  }[];
}

/** Справочники направления для форм управления. */
export interface ManageRefs {
  canManage: boolean;
  sections: { id: number; name: string; note: string | null; isArchived: boolean; sites: number }[];
  workTypes: { id: number; name: string; group: string | null; unit: string | null; weight: number | null; planStart: string | null; planEnd: string | null; isArchived: boolean; items: number }[];
  organizations: { id: number; name: string; kind: (typeof ORGANIZATION_KINDS)[number]; inn: string | null; note: string | null; sites: number }[];
  statuses: { code: string; name: string; entity: 'SITE' | 'WORK_ITEM' }[];
  fields: { code: string; label: string; type: string; unit: string | null; group: string | null; required: boolean; options: { value: string; label: string }[] | null }[];
  users: { id: number; fullName: string; position: string | null; canLogin: boolean }[];
  sites: { id: number; name: string; section: string | null; isArchived: boolean; items: number; curators: string[] }[];
}
