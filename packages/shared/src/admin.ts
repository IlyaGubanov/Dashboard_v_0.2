import { z } from 'zod';
import { PERIOD_KINDS, PROGRESS_METHODS } from './directions';

/** Код записи: латиница, цифры, «_» и «-», начинается с буквы. Код не меняется после создания. */
export const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/, 'Латиница, цифры, «_», «-»; начинается с буквы; до 32 символов');

export const PLAN_METHODS = ['LINEAR_ITEM_DATES', 'LINEAR_SITE_DATES', 'NONE'] as const;
export const PLAN_METHOD_LABELS: Record<(typeof PLAN_METHODS)[number], string> = {
  LINEAR_ITEM_DATES: 'Линейно по срокам каждой позиции',
  LINEAR_SITE_DATES: 'Линейно по срокам объекта',
  NONE: 'Графика нет',
};
export const MONEY_SOURCES = ['WORK_ITEMS', 'CONTRACTS', 'SITE_LIMIT', 'NONE'] as const;
export const MONEY_SOURCE_LABELS: Record<(typeof MONEY_SOURCES)[number], string> = {
  WORK_ITEMS: 'Стоимость позиций (КС-2 и оплата по позициям)',
  CONTRACTS: 'Договоры объекта (КС по объекту)',
  SITE_LIMIT: 'Лимит объекта (оплата по объекту)',
  NONE: 'Деньги не ведутся',
};
export const ICONS = ['school', 'building', 'pipe', 'road', 'folder'] as const;

export const directionSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2, 'Укажите название').max(200),
    shortName: z.string().trim().min(2, 'Укажите краткое название').max(60),
    description: z.string().trim().max(2000).nullable().optional(),
    icon: z.enum(ICONS).default('folder'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет вида #2f6fd6').default('#2f6fd6'),
    sort: z.number().int().default(100),
    isActive: z.boolean().default(true),
    isReadonly: z.boolean().default(false),
    periodKind: z.enum(PERIOD_KINDS),
    planWeekday: z.number().int().min(1).max(7).default(3),
    progressMethod: z.enum(PROGRESS_METHODS),
    planMethod: z.enum(PLAN_METHODS),
    moneySource: z.enum(MONEY_SOURCES).default('NONE'),
    moneyLabel: z.string().trim().max(40).nullable().optional(),
    thrWarn: z.number().min(-100).max(0, 'Отрицательное число, п.п.'),
    thrCrit: z.number().min(-100).max(0, 'Отрицательное число, п.п.'),
    siteUnit: z.string().trim().min(1).max(40).default('объектов'),
    factLabel: z.string().trim().max(120).nullable().optional(),
    /** создать по образцу: скопировать статусы, доп. поля, надстройки, виды работ и показатели */
    copyFrom: codeSchema.optional(),
  })
  .refine((d) => d.thrCrit <= d.thrWarn, { message: '«Критично» должно быть строже «отставания»', path: ['thrCrit'] });
export type DirectionInput = z.input<typeof directionSchema>;
export type DirectionData = z.output<typeof directionSchema>;

const options = z
  .array(
    z.object({
      value: z.string().trim().min(1).max(100),
      label: z.string().trim().min(1).max(100),
      color: z.string().max(20).optional(),
      done: z.boolean().optional(),
    }),
  )
  .max(50);

export const statusesSchema = z.object({
  entity: z.enum(['SITE', 'WORK_ITEM']),
  items: z
    .array(
      z.object({
        code: codeSchema,
        name: z.string().trim().min(1).max(100),
        shortName: z.string().trim().max(40).nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        countsAsDone: z.boolean().default(false),
        excludeFromCalc: z.boolean().default(false),
        isFinal: z.boolean().default(false),
      }),
    )
    .max(30),
});

export const FIELD_TYPES = ['TEXT', 'LONGTEXT', 'NUMBER', 'MONEY', 'PERCENT', 'DATE', 'BOOL', 'SELECT', 'MULTISELECT', 'URL'] as const;
export const FIELD_TYPE_LABELS: Record<(typeof FIELD_TYPES)[number], string> = {
  TEXT: 'Строка',
  LONGTEXT: 'Текст',
  NUMBER: 'Число',
  MONEY: 'Деньги',
  PERCENT: 'Процент',
  DATE: 'Дата',
  BOOL: 'Да / нет',
  SELECT: 'Выбор из списка',
  MULTISELECT: 'Несколько из списка',
  URL: 'Ссылка',
};

export const fieldsSchema = z.object({
  entity: z.enum(['SITE', 'WORK_ITEM']),
  items: z
    .array(
      z
        .object({
          code: codeSchema,
          label: z.string().trim().min(1).max(200),
          type: z.enum(FIELD_TYPES),
          options: options.nullable().optional(),
          unit: z.string().trim().max(20).nullable().optional(),
          required: z.boolean().default(false),
          groupName: z.string().trim().max(100).nullable().optional(),
          hint: z.string().trim().max(400).nullable().optional(),
          showInList: z.boolean().default(false),
        })
        .refine((f) => !['SELECT', 'MULTISELECT'].includes(f.type) || (f.options?.length ?? 0) > 0, { message: 'Добавьте варианты', path: ['options'] }),
    )
    .max(60),
});

export const TRACKER_VALUE_TYPES = ['PERCENT', 'NUMBER', 'BOOL', 'STATUS', 'DATE', 'TEXT'] as const;
export const TRACKER_VALUE_LABELS: Record<(typeof TRACKER_VALUE_TYPES)[number], string> = {
  PERCENT: 'Процент выполнения',
  NUMBER: 'Число',
  BOOL: 'Да / нет',
  STATUS: 'Статус из списка',
  DATE: 'Дата',
  TEXT: 'Текст',
};

export const trackerDefSchema = z.object({
  name: z.string().trim().min(1).max(200),
  layout: z.enum(['MATRIX', 'CARD']),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
  stages: z
    .array(
      z
        .object({
          code: codeSchema,
          name: z.string().trim().min(1).max(200),
          valueType: z.enum(TRACKER_VALUE_TYPES),
          options: options.nullable().optional(),
          inProgress: z.boolean().default(true),
        })
        .refine((s) => s.valueType !== 'STATUS' || (s.options?.length ?? 0) > 0, { message: 'Добавьте статусы', path: ['options'] }),
    )
    .min(1, 'Нужен хотя бы один этап')
    .max(30),
  items: z
    .array(
      z.object({
        code: codeSchema,
        name: z.string().trim().min(1).max(300),
        category: z.string().trim().max(200).nullable().optional(),
        unit: z.string().trim().max(20).nullable().optional(),
      }),
    )
    .min(1, 'Нужна хотя бы одна строка')
    .max(500),
});

/** Каталог метрик для доп. показателей сводки (реализация — apps/api/src/kpi/metrics.ts). */
export type MetricParamKind = 'statusCodes' | 'texts' | 'unit' | 'tracker' | 'stage';
export const METRIC_CATALOG: { key: string; title: string; params: { name: string; label: string; kind: MetricParamKind }[] }[] = [
  { key: 'toPay', title: 'К оплате: принято по КС-2, но не оплачено', params: [] },
  { key: 'overdueItems', title: 'Позиций с истёкшим сроком и не выполненных', params: [] },
  { key: 'itemsByStatus', title: 'Позиций в выбранных статусах', params: [{ name: 'statuses', label: 'Статусы', kind: 'statusCodes' }] },
  { key: 'qtyByUnit', title: 'Сумма фактических объёмов в единице', params: [{ name: 'unit', label: 'Единица', kind: 'unit' }] },
  { key: 'sitesDone', title: 'Выполненных объектов (из N)', params: [] },
  { key: 'advance', title: 'Аванс по договорам', params: [] },
  { key: 'scheduleLagDays', title: 'Отставание от графика в днях', params: [] },
  {
    key: 'trackerOverdue',
    title: 'Строк надстройки с прошедшей датой и незавершённым этапом',
    params: [
      { name: 'tracker', label: 'Надстройка', kind: 'tracker' },
      { name: 'stage', label: 'Этап', kind: 'stage' },
    ],
  },
  {
    key: 'trackerStatusDone',
    title: 'Объектов, где этап надстройки в итоговом статусе (из N)',
    params: [
      { name: 'tracker', label: 'Надстройка', kind: 'tracker' },
      { name: 'stage', label: 'Этап', kind: 'stage' },
    ],
  },
  { key: 'reportStatusCount', title: 'Объектов отчёта со статусом из списка (из N)', params: [{ name: 'statuses', label: 'Статусы отчёта', kind: 'texts' }] },
  { key: 'sitesWithRemainder', title: 'Объектов с невыполненными объёмами', params: [{ name: 'doneStatuses', label: 'Кроме статусов', kind: 'texts' }] },
  { key: 'remarksTotal', title: 'Замечаний в отчёте', params: [] },
  { key: 'remarksOpen', title: 'Замечаний не закрыто (из N за всё время)', params: [] },
  { key: 'remarksOverdue', title: 'Замечаний просрочено', params: [] },
  { key: 'forecastLate', title: 'Объектов, не успевающих к сроку по прогнозу (из N с планом)', params: [] },
  { key: 'peopleTotal', title: 'Людей на объектах', params: [] },
];

export const kpisSchema = z
  .array(
    z.object({
      metric: z.string().refine((k) => METRIC_CATALOG.some((m) => m.key === k), 'Неизвестная метрика'),
      label: z.string().trim().min(1).max(80),
      params: z.record(z.string(), z.union([z.string().max(64), z.array(z.string().max(100)).max(30)])).optional(),
    }),
  )
  .max(6);

export const overviewThresholdsSchema = z
  .object({ warn: z.number().min(-100).max(0), crit: z.number().min(-100).max(0) })
  .refine((t) => t.crit <= t.warn, { message: '«Критично» должно быть строже «отставания»', path: ['crit'] });

/** Направление целиком для конструктора. */
export interface DirectionDef extends Omit<DirectionData, 'copyFrom' | 'description' | 'moneyLabel' | 'factLabel'> {
  id: number;
  description: string | null;
  moneyLabel: string | null;
  factLabel: string | null;
  counts: { sites: number; periods: number; members: number };
  statuses: { entity: 'SITE' | 'WORK_ITEM'; code: string; name: string; shortName: string | null; color: string | null; countsAsDone: boolean; excludeFromCalc: boolean; isFinal: boolean; used: number }[];
  fields: { entity: 'SITE' | 'WORK_ITEM' | 'CONTRACT' | 'SITE_REPORT'; code: string; label: string; type: string; options: { value: string; label: string; color?: string; done?: boolean }[] | null; unit: string | null; required: boolean; groupName: string | null; hint: string | null; showInList: boolean; isArchived: boolean }[];
  trackers: {
    code: string;
    name: string;
    layout: 'MATRIX' | 'CARD';
    description: string | null;
    isActive: boolean;
    rows: number;
    stages: { code: string; name: string; valueType: string; options: { value: string; label: string; color?: string; done?: boolean }[] | null; inProgress: boolean }[];
    items: { code: string; name: string; category: string | null; unit: string | null; isArchived: boolean }[];
  }[];
  kpis: { metric: string; label: string; params?: Record<string, string | string[]> }[];
  units: string[];
}
