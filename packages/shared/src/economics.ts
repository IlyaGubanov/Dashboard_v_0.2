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
  /** КС-2 за месяц без НДС — вносит ПЭО, если в дашборде КС-2 нет */
  ksAmount: money.optional(),
  /** поправка НЗП на конец месяца без НДС (может быть отрицательной: КС-2 опережает выполнение) */
  nzpOverride: z.number({ error: 'Укажите число' }).finite().min(-1e13).max(1e13).nullable().optional(),
  nzpNote: text(500),
  /** закуплено материалов за месяц без НДС (поступление ТМЦ) */
  materialsPurchased: money.optional(),
}).refine((v) => v.nzpOverride == null || !!v.nzpNote?.trim(), { message: 'Укажите причину поправки НЗП', path: ['nzpNote'] });
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
  ksAmount: number | null;
  nzpOverride: number | null;
  nzpNote: string | null;
  materialsPurchased: number | null;
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
  /** по центрам затрат: КС-2 из дашборда за месяц и расчётное НЗП на конец месяца (без НДС) — подсказки для ввода */
  revenue: Record<string, { ksDashMonth: number | null; nzpAuto: number | null; ksSource: EconKsSource }>;
}
/** Откуда КС-2 центра затрат: из дашборда или внесены ПЭО. */
export type EconKsSource = 'dashboard' | 'manual' | null;
/** Результат центра затрат на конец месяца (нарастающим итогом, без НДС). */
export interface EconResult {
  budgetId: number;
  /** готовность работ факт и по графику на конец месяца (дашборд), 0…1 */
  progress: number | null;
  planProgress: number | null;
  costBase: number | null;
  ks: number | null;
  ksSource: EconKsSource;
  /** НЗП: расчётное и итоговое (с поправкой ПЭО) */
  nzpAuto: number | null;
  nzp: number | null;
  nzpNote: string | null;
  /** выручка = КС-2 + НЗП */
  revenue: number | null;
  /** доля выручки центра в выручке всей производственной программы */
  revenueShare: number | null;
  /** общие расходы компании, разнесённые по доле выручки: статья → сумма */
  distributed: Record<string, number>;
}
/** Обзор: факт нарастающим итогом по центрам затрат до выбранного месяца включительно и помесячный ряд за 12 месяцев. */
export interface EconOverview {
  month: string;
  budgets: { budgetId: number; facts: Record<string, number>; laborHours: number | null; machineHours: number | null; months: number }[];
  company: Record<string, number>;
  monthly: { month: string; byArticle: Record<string, number> }[];
  /** результат по всем доступным центрам затрат на конец месяца */
  results: EconResult[];
  /** выручка всей производственной программы (база разнесения общих расходов) */
  programRevenue: number | null;
  /** дата среза дашборда, на которую взяты готовность и КС-2 */
  asOf: string;
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

/** НЗП на конец месяца: выполнено (стоимость без НДС × готовность) − КС-2 нарастающим итогом. */
export function econNzp(costBase: number | null, progress: number | null, ks: number | null): number | null {
  if (costBase == null || progress == null) return null;
  return round2(costBase * Math.min(1, Math.max(0, progress)) - (ks ?? 0));
}

/** Выручка = КС-2 + НЗП (null — нет ни того, ни другого). */
export function econRevenue(ks: number | null, nzp: number | null): number | null {
  return ks == null && nzp == null ? null : round2((ks ?? 0) + (nzp ?? 0));
}

/** Разнесение общей суммы пропорционально доле: total × part ÷ base. */
export function econDistribute(total: number, part: number | null, base: number | null): number | null {
  return part == null || !base || base <= 0 ? null : round2((total * Math.max(0, part)) / base);
}

/** Последний день месяца «ГГГГ-ММ» в виде «ГГГГ-ММ-ДД». */
export function econMonthEnd(month: string): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

// ── Этап 3: движение денежных средств (ДДС), суммы с НДС ──

export const ECON_CASH_KINDS = ['IN', 'OUT'] as const;
export type EconCashKind = (typeof ECON_CASH_KINDS)[number];
/** Таблица ДДС: «C» — общие по компании, «D<id>» — направление. */
export const ECON_CASH_COMPANY = 'C';
export const econCashScope = (directionId: number | null | undefined) => (directionId ? `D${directionId}` : ECON_CASH_COMPANY);
/** Куда по умолчанию подставлять оплату заказчика из дашборда: направление → статья поступлений. */
export const ECON_CASH_INFLOW_BY_DIRECTION: Record<string, string> = { schools: 'in_subsidy', streets: 'in_subsidy', networks: 'in_special', mkd: 'in_commercial' };

export interface EconCashArticle {
  id: number;
  code: string;
  name: string;
  kind: EconCashKind;
  sort: number;
  isArchived: boolean;
}
export interface EconCashValue {
  month: string;
  articleId: number;
  plan: number | null;
  fact: number | null;
}
export interface EconCashSheet {
  scope: string;
  directionId: number | null;
  year: number;
  opening: number | null;
  /** 0 — таблицы за год ещё нет */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  entries: EconCashValue[];
}
export interface EconCashHints {
  /** оплата заказчика по дашборду за месяц, с НДС (разница нарастающих итогов) */
  paid: Record<string, number>;
  /** факт расходов ПЭО за месяц × (1 + НДС): статья ДДС → сумма */
  costs: Record<string, Record<string, number>>;
  /** лимиты центров затрат направления × (1 + НДС): статья ДДС → сумма */
  limits: Record<string, number>;
  /** дебиторская задолженность заказчика по дашборду: КС-2 − оплачено, с НДС (на последний срез) */
  receivable: number | null;
}
export interface EconCashView {
  year: number;
  articles: EconCashArticle[];
  scopes: { scope: string; directionId: number | null; title: string }[];
  sheets: EconCashSheet[];
  monthStatus: Record<string, EconMonthStatus>;
  hints: Record<string, EconCashHints>;
}

const cashCell = z.number({ error: 'Укажите число' }).finite().min(0, 'Сумма не может быть отрицательной').max(1e13, 'Слишком большая сумма').nullable();
export const econCashSaveSchema = z.object({
  version: z.number().int().min(0),
  opening: z.number({ error: 'Укажите число' }).finite().min(-1e13).max(1e13).nullable().optional(),
  entries: z
    .array(z.object({ month: econMonthSchema, articleId: id, plan: cashCell, fact: cashCell }))
    .max(5000)
    .refine((rows) => new Set(rows.map((r) => `${r.month}:${r.articleId}`)).size === rows.length, 'Статья за месяц указана дважды'),
  comment: text(300),
});
export type EconCashSave = z.infer<typeof econCashSaveSchema>;

/** Месяцы года «ГГГГ-01»…«ГГГГ-12». */
export const econYearMonths = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

export interface EconCashMonth {
  month: string;
  inPlan: number;
  outPlan: number;
  inFact: number;
  outFact: number;
}
/**
 * Остаток денег по месяцам: до последнего месяца с фактом — по факту, дальше — по плану (прогноз).
 * Кассовый разрыв — месяц с наименьшим отрицательным остатком.
 */
export function econCashBalance(opening: number | null, months: EconCashMonth[], lastFact: string | null) {
  let balance = opening ?? 0;
  const series = months.map((m) => {
    const actual = lastFact != null && m.month <= lastFact;
    const net = actual ? m.inFact - m.outFact : m.inPlan - m.outPlan;
    balance = round2(balance + net);
    return { month: m.month, net: round2(net), balance, actual };
  });
  const min = series.reduce<(typeof series)[number] | null>((a, x) => (a == null || x.balance < a.balance ? x : a), null);
  return { series, gap: min && min.balance < 0 ? { month: min.month, value: min.balance } : null, min };
}

// ── Этап 4: разбор отклонений (часть 4 таблицы ПЭО «Выводы и анализ отклонений») ──

export const ECON_DEVIATION_KINDS = ['OVERRUN', 'STOCK'] as const;
export type EconDeviationKind = (typeof ECON_DEVIATION_KINDS)[number];
export const ECON_DEVIATION_KIND_LABELS: Record<EconDeviationKind, string> = { OVERRUN: 'Перерасход', STOCK: 'Закупка сверх потребности' };
export const ECON_DEVIATION_STATUSES = ['OPEN', 'IN_WORK', 'RESOLVED', 'DISMISSED'] as const;
export type EconDeviationStatus = (typeof ECON_DEVIATION_STATUSES)[number];
export const ECON_DEVIATION_STATUS_LABELS: Record<EconDeviationStatus, string> = { OPEN: 'Открыто', IN_WORK: 'В работе', RESOLVED: 'Решено', DISMISSED: 'Снято' };
export const econDeviationActive = (s: EconDeviationStatus) => s === 'OPEN' || s === 'IN_WORK';

/** Причины отклонений (по методике ПЭО: доп. объёмы или необоснованный убыток). */
export const ECON_CAUSES = [
  { code: 'volume', label: 'Увеличение объёмов работ' },
  { code: 'price', label: 'Рост цен поставщиков и подрядчиков' },
  { code: 'productivity', label: 'Низкая производительность, простои' },
  { code: 'rework', label: 'Переделки, брак' },
  { code: 'limit', label: 'Ошибка в лимите (норме)' },
  { code: 'accounting', label: 'Ошибка учёта (отнесение затрат)' },
  { code: 'stock', label: 'Закупка впрок, излишки на складе' },
  { code: 'other', label: 'Другое' },
] as const;
export type EconCause = (typeof ECON_CAUSES)[number]['code'];
/** Решения: доказать доп. объёмы заказчику или решить, за счёт чего компенсировать убыток. */
export const ECON_DECISIONS = [
  { code: 'claim', label: 'Доп. соглашение с заказчиком на доп. объёмы' },
  { code: 'compensate', label: 'Компенсировать экономией по другим статьям' },
  { code: 'limit', label: 'Скорректировать лимит (норму)' },
  { code: 'supplier', label: 'Претензия поставщику или подрядчику' },
  { code: 'stop_purchase', label: 'Приостановить закупки, использовать остатки' },
  { code: 'accept', label: 'Принять убыток' },
  { code: 'other', label: 'Другое' },
] as const;
export type EconDecision = (typeof ECON_DECISIONS)[number]['code'];
const causeCodes = ECON_CAUSES.map((c) => c.code) as [EconCause, ...EconCause[]];
const decisionCodes = ECON_DECISIONS.map((c) => c.code) as [EconDecision, ...EconDecision[]];
export const econCauseLabel = (code: string) => ECON_CAUSES.find((c) => c.code === code)?.label ?? code;
export const econDecisionLabel = (code: string) => ECON_DECISIONS.find((c) => c.code === code)?.label ?? code;

/** Закупка материалов к потребности на выполненный объём: до 1,2 — норма, до 1,5 — внимание, больше — деньги заморожены на складе. */
export const ECON_STOCK_THRESHOLDS = { warn: 1.2, crit: 1.5 };
export function econStockStatus(ratio: number | null): EconStatus {
  if (ratio == null) return 'none';
  return ratio <= ECON_STOCK_THRESHOLDS.warn ? 'good' : ratio <= ECON_STOCK_THRESHOLDS.crit ? 'warning' : 'critical';
}

const isoDate = z
  .string({ error: 'Укажите дату' })
  .regex(/^20\d{2}-\d{2}-\d{2}$/, 'Укажите дату')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Некорректная дата');
const deviationFields = {
  cause: z.enum(causeCodes, { error: 'Выберите причину' }),
  causeText: text(2000),
  decision: z.enum(decisionCodes, { error: 'Выберите решение' }),
  decisionText: text(2000),
  responsibleId: z.number({ error: 'Выберите ответственного' }).int().positive('Выберите ответственного'),
  dueDate: isoDate,
};
const otherNeedsText = (v: { cause?: string; causeText?: string | null; decision?: string; decisionText?: string | null }, ctx: z.RefinementCtx) => {
  if (v.cause === 'other' && !v.causeText?.trim()) ctx.addIssue({ code: 'custom', path: ['causeText'], message: 'Опишите причину' });
  if (v.decision === 'other' && !v.decisionText?.trim()) ctx.addIssue({ code: 'custom', path: ['decisionText'], message: 'Опишите решение' });
};
export const econDeviationCreateSchema = z
  .object({ budgetId: id, articleId: id, kind: z.enum(ECON_DEVIATION_KINDS), month: econMonthSchema, ...deviationFields })
  .superRefine(otherNeedsText);
export type EconDeviationCreate = z.infer<typeof econDeviationCreateSchema>;
/** Правка: ПЭО меняет всё; ответственный — статус и итог. Для «Решено» и «Снято» итог обязателен. */
export const econDeviationUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(ECON_DEVIATION_STATUSES),
    result: text(2000),
    cause: deviationFields.cause.optional(),
    causeText: deviationFields.causeText,
    decision: deviationFields.decision.optional(),
    decisionText: deviationFields.decisionText,
    responsibleId: deviationFields.responsibleId.optional(),
    dueDate: isoDate.optional(),
  })
  .superRefine((v, ctx) => {
    otherNeedsText(v, ctx);
    if ((v.status === 'RESOLVED' || v.status === 'DISMISSED') && !v.result?.trim()) ctx.addIssue({ code: 'custom', path: ['result'], message: 'Опишите итог: что сделано' });
  });
export type EconDeviationUpdate = z.infer<typeof econDeviationUpdateSchema>;

/** Найденное отклонение на конец месяца (нарастающим итогом). */
export interface EconDeviationItem {
  budgetId: number;
  articleId: number;
  kind: EconDeviationKind;
  plan: number | null;
  fact: number | null;
  /** минус — перерасход (излишек закупки) */
  amount: number | null;
  pct: number | null;
  status: EconStatus;
  /** разбор по этому отклонению (активный или заведённый за этот месяц) */
  recordId: number | null;
}
export interface EconStockRow {
  budgetId: number;
  purchased: number;
  /** потребность на выполненный объём: лимит материалов × готовность */
  need: number | null;
  /** списано в производство (факт статьи «Материалы») */
  consumed: number;
  surplus: number | null;
  ratio: number | null;
  status: EconStatus;
}
export interface EconDeviationRecord {
  id: number;
  budgetId: number;
  articleId: number;
  kind: EconDeviationKind;
  month: string;
  plan: number | null;
  fact: number | null;
  amount: number | null;
  pct: number | null;
  cause: string;
  causeText: string | null;
  decision: string;
  decisionText: string | null;
  responsible: { id: number; fullName: string } | null;
  dueDate: string | null;
  status: EconDeviationStatus;
  result: string | null;
  version: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  overdue: boolean;
}
export interface EconDeviationsView {
  month: string;
  items: EconDeviationItem[];
  stock: EconStockRow[];
  records: EconDeviationRecord[];
  /** кого можно назначить ответственным: направление → сотрудники с доступом к разделу */
  candidates: Record<string, { id: number; fullName: string }[]>;
  canEdit: boolean;
  userId: number;
}
