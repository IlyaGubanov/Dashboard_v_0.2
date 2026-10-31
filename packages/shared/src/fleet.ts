import { z } from 'zod';

export const FLEET_KINDS = ['vehicles', 'assignments', 'incidents', 'fines', 'tolls', 'fuel', 'downtime', 'requests', 'snapshots'] as const;
export type FleetKind = typeof FLEET_KINDS[number];
export const FLEET_LABELS: Record<FleetKind | 'overview', string> = { overview: 'Обзор РЭБ', vehicles: 'Реестр техники', assignments: 'Распределение техники', incidents: 'ДТП', fines: 'Штрафы', tolls: 'Платные дороги', fuel: 'Топливо', downtime: 'Неиспользуемая техника', requests: 'Потребности в технике', snapshots: 'Исторические срезы' };
export const OWNERSHIP = { OWN: 'Собственная', RENTED: 'Арендуемая', UNKNOWN: 'Не установлена' };
export const TECHNICAL_STATE = { OK: 'Исправна', FAULTY: 'Неисправна', REPAIR: 'В ремонте', RETIRED: 'Выведена из эксплуатации', UNKNOWN: 'Не установлено' };
export const USAGE_STATE = { ACTIVE: 'Задействована', RESERVE: 'В резерве', UNASSIGNED: 'Не распределена', UNNEEDED: 'Временно не востребована', UNKNOWN: 'Не установлено' };
export const PAYMENT_STATUS = { DETECTED: 'Обнаружен', REVIEW: 'На проверке', TO_PAY: 'Передан на оплату', PARTIAL: 'Частично оплачен', PAID: 'Оплачен', DISPUTED: 'Оспаривается', CANCELLED: 'Отменён' };
export const REQUEST_STATUS = { NEW: 'Новая', REVIEW: 'На рассмотрении', IN_PROGRESS: 'В работе', PARTIAL: 'Частично обеспечена', FULFILLED: 'Обеспечена', CANCELLED: 'Отменена', REJECTED: 'Отклонена' };
export const INCIDENT_STATUS = { REVIEW: 'На рассмотрении', INVESTIGATION: 'Разбирательство', REPAIR: 'Ремонт', CLOSED: 'Завершено' };
export const DOWNTIME_REASON = { UNNEEDED: 'Нет потребности', REPAIR: 'Ремонт', FAULTY: 'Неисправность', OTHER: 'Другая причина' };
export const FUEL_CATEGORIES = ['Автотранспорт и дорожно-строительная техника', 'Малая механизация', 'Личный автотранспорт', 'СМУ', 'Иное (обеспечение объектов Вода, контрагенты и т.д.)', 'Итого по источнику'] as const;

const enumKeys = <T extends Record<string, string>>(labels: T) => z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]);
const text = (n = 200) => z.string().trim().max(n, `Не больше ${n} символов`);
const nullableText = (n = 200) => text(n).nullable().optional();
const id = z.number().int().positive();
const ref = id.nullable().optional();
export const fleetDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата: ГГГГ-ММ-ДД').refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Несуществующая дата');
export const fleetMoney = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Неотрицательная сумма, максимум 2 знака после точки');
const money = fleetMoney.nullable().optional();
const date = fleetDate.nullable().optional();
const base = { version: z.number().int().positive().optional(), note: nullableText(5000) };
const context = { siteId: ref, targetDirectionId: ref, departmentId: ref, employeeId: ref };
const vehicleRef = { vehicleId: ref, plate: nullableText(32) };
const payment = { ...base, ...context, ...vehicleRef, chargeDate: date, detectedDate: date, amount: fleetMoney, paidAmount: money, paidDate: date,
  paymentDocument: nullableText(500), status: enumKeys(PAYMENT_STATUS).default('REVIEW'), sourceStatus: nullableText(200) };

function periodCheck(v: { startDate?: string | null; endDate?: string | null }, ctx: z.RefinementCtx) {
  if (v.startDate && v.endDate && v.endDate <= v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Окончание должно быть позже начала (конечная дата не включается)' });
}
function paymentCheck(v: { amount: string; paidAmount?: string | null; status: string; paidDate?: string | null }, ctx: z.RefinementCtx) {
  // Строки ограничены до 13 цифр: сравнение безопасно; расчёт на сервере использует Decimal.
  if (v.paidAmount != null && Number(v.paidAmount) > Number(v.amount)) ctx.addIssue({ code: 'custom', path: ['paidAmount'], message: 'Оплата больше начисления' });
  if (v.status === 'PAID' && (v.paidAmount == null || Number(v.amount) !== Number(v.paidAmount) || !v.paidDate)) ctx.addIssue({ code: 'custom', path: ['paidAmount'], message: 'Укажите подтверждённую полную оплату и её дату' });
  if (v.status === 'PARTIAL' && (v.paidAmount == null || Number(v.paidAmount) <= 0 || Number(v.paidAmount) >= Number(v.amount))) ctx.addIssue({ code: 'custom', path: ['paidAmount'], message: 'Частичная оплата должна быть больше нуля и меньше начисления' });
}

export const vehicleSchema = z.object({ ...base, inventoryNumber: nullableText(80), plate: nullableText(32), vin: nullableText(80), name: text().min(2, 'Введите наименование'), kind: text(100).min(1, 'Укажите вид'), category: nullableText(100), brand: nullableText(100), model: nullableText(100),
  ownership: enumKeys(OWNERSHIP).default('UNKNOWN'), ownerId: ref, rentStart: date, rentEnd: date, technicalState: enumKeys(TECHNICAL_STATE).default('UNKNOWN'), usageState: enumKeys(USAGE_STATE).default('UNKNOWN'), employeeId: ref, departmentId: ref,
}).strict().superRefine((v,ctx) => { if (v.rentStart && v.rentEnd && v.rentEnd < v.rentStart) ctx.addIssue({ code: 'custom', path: ['rentEnd'], message: 'Окончание аренды раньше начала' }); });
export const assignmentSchema = z.object({ ...base, vehicleId: id, targetDirectionId: id, siteId: ref, employeeId: ref, startDate: fleetDate, endDate: date }).strict().superRefine(periodCheck);
export const incidentSchema = z.object({ ...base, ...vehicleRef, ...context, occurredAt: z.iso.datetime({ offset: true }), incidentType: text().min(1, 'Укажите вид происшествия'), location: nullableText(500), description: nullableText(5000), cause: nullableText(2000), registrationMethod: nullableText(200), casualties: z.boolean().nullable().optional(), status: enumKeys(INCIDENT_STATUS).default('REVIEW'), culpritCategory: nullableText(200), culpritConfirmed: z.boolean().default(false), conditionAfter: nullableText(500), repairRequired: z.boolean().nullable().optional(), expectedReturn: date, actualReturn: date, delayReason: nullableText(2000), damage: money, repairCost: money, insuranceCompensation: money, thirdPartyCompensation: money, recoveredAmount: money,
}).strict().superRefine((v,ctx) => { if (v.culpritCategory && !v.culpritConfirmed) ctx.addIssue({ code: 'custom', path: ['culpritConfirmed'], message: 'Для указания виновника необходимо подтверждение' }); });
export const fineSchema = z.object({ ...payment, uin: text(80).regex(/^\d+$/, 'УИН сохраняется строкой из цифр').nullable().optional(), violationDate: date, violation: text(2000).min(1, 'Укажите нарушение'), fullAmount: money, confirmedDiscount: money, discountUntil: date, dueDate: date, submittedDate: date }).strict().superRefine(paymentCheck);
export const tollSchema = z.object({ ...payment, chargeIdentifier: nullableText(100), passageDate: fleetDate, route: text(1000).min(1, 'Укажите дорогу или маршрут') }).strict().superRefine(paymentCheck);
export const fuelSchema = z.object({ ...base, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Период: ГГГГ-ММ'), fuelType: text(80).min(1), category: text(200).min(1), liters: fleetMoney, cost: money, dailyLiters: money, dailyCost: money, dailyMethod: nullableText(1000), source: text(500).min(1, 'Укажите источник'), isReportedTotal: z.boolean().default(false) }).strict().superRefine((v,ctx) => { if ((v.dailyLiters != null || v.dailyCost != null) && !v.dailyMethod) ctx.addIssue({ code: 'custom', path: ['dailyMethod'], message: 'Укажите методику или пометку «Значение источника, методика не подтверждена»' }); });
export const downtimeSchema = z.object({ ...base, vehicleId: id, reason: enumKeys(DOWNTIME_REASON), startDate: fleetDate, endDate: date, expectedReturn: date, employeeId: ref, comment: nullableText(2000) }).strict().superRefine(periodCheck);
export const requestSchema = z.object({ ...base, ...context, requestDate: fleetDate, kind: text(100).min(1), quantity: z.number().int().min(1).max(10000), workPurpose: text(2000).min(1, 'Укажите работы'), reason: text(2000).min(1, 'Укажите причину'), startDate: fleetDate, endDate: fleetDate, priority: z.enum(['LOW','NORMAL','HIGH','URGENT']).default('NORMAL'), initiatorId: ref, status: enumKeys(REQUEST_STATUS).default('NEW'), decisionReason: nullableText(2000), allocationIds: z.array(id).max(1000).default([]) }).strict().superRefine((v,ctx) => { periodCheck(v,ctx); if (['CANCELLED','REJECTED'].includes(v.status) && !v.decisionReason) ctx.addIssue({ code: 'custom', path: ['decisionReason'], message: 'Укажите причину отмены или отклонения' }); if (new Set(v.allocationIds).size !== v.allocationIds.length) ctx.addIssue({ code: 'custom', path: ['allocationIds'], message: 'Повторное назначение в заявке' }); });
export const snapshotSchema = z.object({ ...base, asOfDate: fleetDate, source: text(500).min(1), total: z.number().int().min(0), used: z.number().int().min(0).nullable().optional(), unused: z.number().int().min(0).nullable().optional(), own: z.number().int().min(0).nullable().optional(), rented: z.number().int().min(0).nullable().optional(), repair: z.number().int().min(0).nullable().optional(), reserve: z.number().int().min(0).nullable().optional(), breakdown: z.array(z.object({ label: text(), quantity: z.number().int().min(0), targetDirectionId: ref })).max(100).default([]), details: nullableText(10000) }).strict();
export const liabilitySchema = z.object({ version: z.number().int().positive().optional(), employeeId: id, confirmedAmount: fleetMoney, recoveredAmount: fleetMoney, evidence: text(2000).min(3, 'Укажите документ подтверждения'), note: nullableText(2000) }).strict().refine(v => Number(v.recoveredAmount) <= Number(v.confirmedAmount), { path: ['recoveredAmount'], message: 'Возмещение больше подтверждённой ответственности' });
export const FLEET_SCHEMAS = { vehicles: vehicleSchema, assignments: assignmentSchema, incidents: incidentSchema, fines: fineSchema, tolls: tollSchema, fuel: fuelSchema, downtime: downtimeSchema, requests: requestSchema, snapshots: snapshotSchema };

export type FleetRow = { id: number; directionId: number; version: number; isArchived: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
export type FleetReference = { id: number; name: string; directionId?: number; position?: string | null; phone?: string | null };
export interface FleetRefs { directionId: number; canEdit: boolean; canManage: boolean; canFinance: boolean; canLiability: boolean; canAudit: boolean; users: FleetReference[]; departments: FleetReference[]; organizations: FleetReference[]; directions: FleetReference[]; sites: FleetReference[]; vehicles: FleetReference[]; assignments: FleetReference[]; fuelTypes: string[] }
export interface FleetList { rows: FleetRow[]; total: number }
export interface FleetOverview { asOf: string | null; counts: { total: number; own: number; rented: number; unknown: number; used: number; unused: number; repair: number; reserve: number } | null; incidents: number | null; fines: FleetPayments | null; tolls: FleetPayments | null; fuel: { liters: string | null; cost: string | null }; openRequests: number | null; snapshot: FleetRow | null; warnings: string[] }
export interface FleetPayments { count: number; charged: string | null; paid: string | null; balance: string | null; overdue: number }
