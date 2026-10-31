import { z } from 'zod';

/**
 * Раздел «Экономика», этап 1: нормы и лимиты расходов по центрам затрат и ежемесячный факт ПЭО.
 * Все суммы — в рублях без НДС; стоимость из дашборда хранится с НДС и пересчитывается по ставке из настроек.
 */
export const ECON_ARTICLE_KINDS = ['DIRECT', 'OVERHEAD', 'ADMIN'] as const;
export type EconArticleKind = (typeof ECON_ARTICLE_KINDS)[number];
export const ECON_ARTICLE_KIND_LABELS: Record<EconArticleKind, { label: string; description: string }> = {
  DIRECT: { label: 'Прямые', description: 'Факт вносится по каждому центру затрат' },
  OVERHEAD: { label: 'Общепроизводственные', description: 'Факт — общей суммой за месяц, разносится по объектам пропорционально выручке' },
  ADMIN: { label: 'Административные', description: 'Факт — общей суммой за месяц, разносится по объектам пропорционально выручке' },
};
/** Статьи, факт по которым вносится общей суммой на компанию. */
export const econIsCompanyKind = (kind: EconArticleKind) => kind !== 'DIRECT';

export const ECON_SCOPES = ['DIRECTION', 'SECTION', 'SITE'] as const;
export type EconScope = (typeof ECON_SCOPES)[number];
export const ECON_SCOPE_LABELS: Record<EconScope, string> = { DIRECTION: 'Всё направление', SECTION: 'Лот', SITE: 'Объект' };

export const ECON_LIMIT_METHODS = ['SHARE', 'AMOUNT'] as const;
export type EconLimitMethod = (typeof ECON_LIMIT_METHODS)[number];
export const ECON_LIMIT_METHOD_LABELS: Record<EconLimitMethod, string> = { SHARE: '% от стоимости', AMOUNT: 'Расчётная сумма' };

export const ECON_MONTH_STATUSES = ['OPEN', 'CLOSED', 'LOCKED'] as const;
export type EconMonthStatus = (typeof ECON_MONTH_STATUSES)[number];
export const ECON_MONTH_STATUS_LABELS: Record<EconMonthStatus, string> = { OPEN: 'Открыт', CLOSED: 'Закрыт ПЭО', LOCKED: 'Заблокирован' };

/** Ставка НДС по умолчанию (с 2026 года). Меняется в настройках раздела. */
export const ECON_DEFAULT_VAT_RATE = 22;

const money = z.number({ error: 'Укажите число' }).finite().min(0, 'Сумма не может быть отрицательной').max(1e13, 'Слишком большая сумма').nullable();
const hours = z.number({ error: 'Укажите число' }).finite().min(0, 'Часы не могут быть отрицательными').max(1e9, 'Слишком большое значение').nullable();
const text = (max: number) => z.string().trim().max(max, `Не длиннее ${max} символов`).nullable().optional();
const id = z.number().int().positive();

export const econMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Укажите месяц в формате ГГГГ-ММ');

export const econArticleSchema = z.object({
  name: z.string().trim().min(2, 'Не короче 2 символов').max(200, 'Не длиннее 200 символов'),
  kind: z.enum(ECON_ARTICLE_KINDS),
  method: text(4000),
  sort: z.number().int().min(0).max(100000).optional(),
  isArchived: z.boolean().optional(),
});
export type EconArticleInput = z.infer<typeof econArticleSchema>;

export const econLimitInputSchema = z
  .object({
    articleId: id,
    method: z.enum(ECON_LIMIT_METHODS),
    sharePct: z.number({ error: 'Укажите число' }).finite().min(0, 'Доля не может быть отрицательной').max(100, 'Доля — не больше 100%').nullable(),
    amount: money,
    setBy: text(200),
    note: text(2000),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'SHARE' && v.sharePct == null) ctx.addIssue({ code: 'custom', path: ['sharePct'], message: 'Укажите долю, %' });
    if (v.method === 'AMOUNT' && v.amount == null) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Укажите сумму' });
  });
export type EconLimitInput = z.infer<typeof econLimitInputSchema>;

export const econBudgetCreateSchema = z
  .object({ directionId: id, scope: z.enum(ECON_SCOPES), sectionId: id.nullable().optional(), siteId: id.nullable().optional() })
  .superRefine((v, ctx) => {
    if (v.scope === 'SECTION' && !v.sectionId) ctx.addIssue({ code: 'custom', path: ['sectionId'], message: 'Выберите лот' });
    if (v.scope === 'SITE' && !v.siteId) ctx.addIssue({ code: 'custom', path: ['siteId'], message: 'Выберите объект' });
  });
export type EconBudgetCreate = z.infer<typeof econBudgetCreateSchema>;

export const econBudgetSaveSchema = z.object({
  version: z.number().int().positive(),
  costNet: money,
  vatExempt: z.boolean(),
  laborHoursNorm: hours,
  machineHoursNorm: hours,
  note: text(4000),
  isArchived: z.boolean().optional(),
  limits: z
    .array(econLimitInputSchema)
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.articleId)).size === rows.length, 'Статья указана дважды'),
});
export type EconBudgetSave = z.infer<typeof econBudgetSaveSchema>;

/** Суммы по статьям: ключ — id статьи. Пустое значение (null) — удалить сумму. */
const amounts = z.record(z.string().regex(/^\d+$/), money);
export const econFactRowSchema = z.object({
  budgetId: id,
  /** 0 — строки за месяц ещё нет */
  version: z.number().int().min(0),
  laborHours: hours,
  machineHours: hours,
  note: text(2000),
  amounts,
});
export type EconFactRowInput = z.infer<typeof econFactRowSchema>;
export const econMonthSaveSchema = z.object({
  rows: z
    .array(econFactRowSchema)
    .max(3000)
    .refine((rows) => new Set(rows.map((r) => r.budgetId)).size === rows.length, 'Центр затрат указан дважды'),
  /** Общие расходы компании за месяц; version — версия месяца (0 — месяца ещё нет) */
  company: z.object({ version: z.number().int().min(0), amounts }).optional(),
  comment: text(300),
});
export type EconMonthSave = z.infer<typeof econMonthSaveSchema>;
export const econMonthStatusSchema = z.object({ status: z.enum(ECON_MONTH_STATUSES), version: z.number().int().min(0) });
export const econEditorsSchema = z.object({ userIds: z.array(id).max(500) });
export const econSettingsSchema = z.object({
  vatRate: z.number({ error: 'Укажите число' }).finite().min(0, 'Не меньше 0').max(50, 'Не больше 50'),
  /** средняя тарифная ставка рабочего, ₽ за чел.-ч без НДС — для расчёта нормы трудочасов из лимита ФОТ */
  laborRate: z.number({ error: 'Укажите число' }).finite().min(0).max(100_000, 'Слишком большая ставка').nullable().optional(),
  /** средняя стоимость машино-часа, ₽ без НДС — для нормы машино-часов из лимита техники */
  machineRate: z.number({ error: 'Укажите число' }).finite().min(0).max(1_000_000, 'Слишком большая ставка').nullable().optional(),
});
export type EconSettings = z.infer<typeof econSettingsSchema>;

export interface EconPermissions {
  canView: boolean;
  /** вносить лимиты и факт (ответственные ПЭО и администратор) */
  canEdit: boolean;
  /** назначать ответственных ПЭО и блокировать месяц — администратор */
  canAdmin: boolean;
}
export interface EconArticle {
  id: number;
  code: string;
  name: string;
  kind: EconArticleKind;
  method: string | null;
  sort: number;
  isArchived: boolean;
}
export interface EconDirectionRef {
  id: number;
  code: string;
  name: string;
  shortName: string;
  sections: { id: number; name: string }[];
  sites: { id: number; name: string; sectionId: number | null }[];
}
export interface EconLimit {
  articleId: number;
  method: EconLimitMethod;
  sharePct: number | null;
  amount: number | null;
  setBy: string | null;
  note: string | null;
  /** лимит в рублях без НДС: введённая сумма или доля × стоимость */
  value: number | null;
}
export interface EconBudget {
  id: number;
  directionId: number;
  scope: EconScope;
  sectionId: number | null;
  siteId: number | null;
  title: string;
  /** сколько объектов дашборда покрывает центр затрат (объекты со своим бюджетом исключаются из лота и направления) */
  sitesCount: number;
  /** стоимость из дашборда, с НДС */
  costGross: number | null;
  /** стоимость без НДС, заданная ПЭО (null — считается из дашборда) */
  costNet: number | null;
  /** стоимость без НДС, от которой считаются доли: заданная или из дашборда */
  costBase: number | null;
  vatExempt: boolean;
  laborHoursNorm: number | null;
  machineHoursNorm: number | null;
  note: string | null;
  isArchived: boolean;
  version: number;
  updatedAt: string;
  limits: EconLimit[];
  limitTotal: number | null;
  /** из дашборда: готовность работ 0…1 (взвешенная по стоимости объектов), КС-2 и оплата нарастающим итогом, с НДС */
  progress: number | null;
  ksGross: number | null;
  paidGross: number | null;
  /** из дашборда: договоры и работы подрядчиков по организациям, с НДС; own — свои подразделения (не субподряд) */
  contractors: EconContractor[];
}
export interface EconContractor {
  name: string;
  amountGross: number;
  own: boolean;
}
export interface EconMonthItem {
  month: string;
  status: EconMonthStatus;
  rows: number;
}
export interface EconSetup {
  permissions: EconPermissions;
  settings: EconSettings;
  articles: EconArticle[];
  directions: EconDirectionRef[];
  budgets: EconBudget[];
  months: EconMonthItem[];
  canExport: boolean;
  canAudit: boolean;
  /** загружены демо-данные экономики (их можно удалить из меню раздела) */
  hasDemo: boolean;
}
export interface EconFactRow {
  budgetId: number;
  version: number;
  laborHours: number | null;
  machineHours: number | null;
  note: string | null;
  amounts: Record<string, number>;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface EconMonthView {
  month: string;
  status: EconMonthStatus;
  version: number;
  closedAt: string | null;
  closedBy: string | null;
  rows: EconFactRow[];
  company: Record<string, number>;
  /** оценка часов за месяц по отчётам дашборда о людях и технике на объектах (null — в направлении таких отчётов нет) */
  reportHours: Record<string, { labor: number | null; machine: number | null; days: number }>;
}
/** Обзор: факт нарастающим итогом по центрам затрат до выбранного месяца включительно и помесячный ряд за 12 месяцев. */
export interface EconOverview {
  month: string;
  budgets: { budgetId: number; facts: Record<string, number>; laborHours: number | null; machineHours: number | null; months: number }[];
  company: Record<string, number>;
  monthly: { month: string; byArticle: Record<string, number> }[];
}
export interface EconEditors {
  users: { id: number; fullName: string; login: string | null }[];
  userIds: number[];
}
export interface EconAuditItem {
  id: string;
  at: string;
  user: string;
  action: string;
  entity: string;
  entityId: string | null;
  comment: string | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Сумма без НДС из суммы с НДС. Объекты «без НДС» (субсидии, упрощёнка) — как есть. */
export function econNet(gross: number | null, vatRate: number, vatExempt: boolean): number | null {
  if (gross == null) return null;
  return vatExempt ? round2(gross) : round2(gross / (1 + vatRate / 100));
}

/** Лимит в рублях: сумма как есть или доля от стоимости без НДС. */
export function econLimitValue(l: Pick<EconLimit, 'method' | 'sharePct' | 'amount'>, costBase: number | null): number | null {
  if (l.method === 'AMOUNT') return l.amount;
  return l.sharePct == null || costBase == null ? null : round2((costBase * l.sharePct) / 100);
}

/** Ключ уникальности центра затрат внутри направления. */
export function econScopeKey(scope: EconScope, sectionId?: number | null, siteId?: number | null): string {
  return scope === 'DIRECTION' ? 'D' : scope === 'SECTION' ? `S${sectionId}` : `O${siteId}`;
}

/** Число из Excel: «1 234 567,89», «1234567.89», «-» и пусто → null; иначе NaN. */
export function econParseNumber(raw: string): number | null {
  const s = raw.replace(/[\s  ₽]/g, '').replace(/руб\.?$/i, '');
  if (!s || s === '-' || s === '—') return null;
  const normalized = /,\d{1,2}$/.test(s) || !s.includes('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const econMonthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** Месяц, за который обычно вносят факт: предыдущий (сч. 20 закрывается к 10 числу следующего). */
export function econDefaultMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/** План затрат на выполненный объём: лимит × готовность работ. */
export function econPlanCost(limit: number | null | undefined, progress: number | null | undefined): number | null {
  return limit == null || progress == null ? null : round2(limit * Math.min(1, Math.max(0, progress)));
}

/** Отклонение факта от плана затрат: сумма (+ экономия, − перерасход) и доля от плана. */
export function econDeviation(plan: number | null, fact: number | null): { amount: number | null; pct: number | null } {
  if (plan == null || fact == null) return { amount: null, pct: null };
  const amount = round2(plan - fact);
  return { amount, pct: plan > 0 ? amount / plan : null };
}

export type EconStatus = 'good' | 'warning' | 'critical' | 'none';
/** Пороги перерасхода к плану затрат — как пороги отставания направлений в сводке: −2% и −10%. */
export const ECON_THRESHOLDS = { warn: -0.02, crit: -0.1 };
export const ECON_STATUS_LABELS: Record<EconStatus, string> = { good: 'В пределах лимита', warning: 'Перерасход до 10%', critical: 'Перерасход более 10%', none: 'Нет данных' };
export function econStatus(pct: number | null): EconStatus {
  if (pct == null) return 'none';
  return pct >= ECON_THRESHOLDS.warn ? 'good' : pct >= ECON_THRESHOLDS.crit ? 'warning' : 'critical';
}

/**
 * Прогноз на завершение при сохранении текущей эффективности: ожидаемые расходы = факт ÷ готовность.
 * При готовности меньше 5% прогноз не строится — слишком мало данных.
 */
export function econForecast(limit: number | null, fact: number | null, progress: number | null): { expected: number; result: number | null } | null {
  if (fact == null || progress == null || progress < 0.05) return null;
  const expected = round2(fact / Math.min(1, progress));
  return { expected, result: limit == null ? null : round2(limit - expected) };
}

/** Свои подразделения (СМУ, РСУ, участки, отделы, сам трест) — их договоры не субподряд. */
export function econIsOwnOrg(name: string): boolean {
  return /мвс\s*ст|мосводосток|(^|[^а-я])(сму|рсу)([^а-я]|$)|участ|отдел/i.test(name);
}
