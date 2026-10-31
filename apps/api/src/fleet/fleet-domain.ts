import { Prisma } from '@prisma/client';

type VehicleState = { ownership: string; technicalState: string; usageState: string };
export function fleetCounts(rows: VehicleState[]) {
  const count = (f: (r: VehicleState) => boolean) => rows.filter(f).length;
  return { total: rows.length, own: count(r => r.ownership === 'OWN'), rented: count(r => r.ownership === 'RENTED'),
    unknown: count(r => r.ownership === 'UNKNOWN'), used: count(r => r.usageState === 'ACTIVE'), unused: count(r => r.usageState !== 'ACTIVE'),
    repair: count(r => r.technicalState === 'REPAIR'), reserve: count(r => r.usageState === 'RESERVE') };
}

/** Полуоткрытые интервалы [начало, окончание): передача в момент окончания разрешена. */
export function overlaps(a: string, b: string | null, c: string, d: string | null) {
  return new Date(a).getTime() < (d ? new Date(d).getTime() : Infinity) && new Date(c).getTime() < (b ? new Date(b).getTime() : Infinity);
}

type Payment = { amount: string | null; paidAmount: string | null; status: string; dueDate?: string | null };
export function paymentTotals(rows: Payment[], today: string) {
  const active = rows.filter(r => r.status !== 'CANCELLED');
  const charged = decimalSum(active.map(r => r.amount));
  const paid = decimalSum(active.map(r => r.paidAmount));
  return { count: rows.length, charged, paid, balance: charged == null || paid == null ? null : new Prisma.Decimal(charged).minus(paid).toFixed(2),
    overdue: active.filter(r => r.dueDate && r.dueDate.slice(0, 10) < today && r.amount != null && r.paidAmount != null && new Prisma.Decimal(r.amount).gt(r.paidAmount)).length };
}

export function decimalSum(values: (string | null)[], empty: string | null = '0.00'): string | null {
  if (!values.length) return empty;
  if (values.some(v => v == null)) return null;
  return values.reduce<Prisma.Decimal>((sum, v) => sum.plus(v!), new Prisma.Decimal(0)).toFixed(2);
}

export function requestStatus(requested: number, allocated: number, status: string) {
  if (status === 'CANCELLED' || status === 'REJECTED') return status;
  if (allocated >= requested) return 'FULFILLED';
  if (allocated > 0) return 'PARTIAL';
  return status === 'FULFILLED' || status === 'PARTIAL' ? 'IN_PROGRESS' : status;
}

/** Знак расхождения = сумма категорий минус заявленный итог. */
export function fuelDifference(parts: (string | null)[], reported: string | null) {
  const sum = decimalSum(parts, null);
  return sum == null || reported == null ? null : new Prisma.Decimal(sum).minus(reported).toFixed(2);
}
