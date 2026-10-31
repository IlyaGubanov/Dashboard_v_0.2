import { Prisma, type PrismaClient } from '@prisma/client';
import type { FleetKind, FleetRow } from '@mvs/shared';

export const FLEET_MODELS = { vehicles: 'fleetVehicle', assignments: 'fleetAssignment', incidents: 'fleetIncident', fines: 'fleetFine', tolls: 'fleetToll', fuel: 'fleetFuel', downtime: 'fleetDowntime', requests: 'fleetRequest', snapshots: 'fleetSnapshot' } as const;
export type DbRow = { id: number; directionId: number; version: number; isArchived: boolean; [key: string]: unknown };
// Общий контракт только для девяти перечисленных моделей; имена и поля проходят zod до обращения к БД.
interface FleetStore {
  findMany(args: Record<string, unknown>): Promise<DbRow[]>;
  findFirst(args: Record<string, unknown>): Promise<DbRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<DbRow>;
  update(args: Record<string, unknown>): Promise<DbRow>;
  updateMany(args: Record<string, unknown>): Promise<{count: number}>;
  count(args: Record<string, unknown>): Promise<number>;
}
export function store(db: Prisma.TransactionClient | PrismaClient, kind: FleetKind): FleetStore {
  return db[FLEET_MODELS[kind]] as unknown as FleetStore;
}
export const MONEY_FIELDS = new Set(['amount','paidAmount','fullAmount','confirmedDiscount','cost','dailyCost','damage','repairCost','insuranceCompensation','thirdPartyCompensation','recoveredAmount','confirmedAmount','balance','paymentDocument','sourceRaw']);
export function redactFleet(value: unknown, finance: boolean): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (Array.isArray(value)) return value.map(v => redactFleet(v, finance));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => finance || !MONEY_FIELDS.has(k)).map(([k,v]) => [k,redactFleet(v,finance)]));
  return typeof value === 'bigint' ? value.toString() : value;
}
export function wire(row: DbRow, finance: boolean): FleetRow { return redactFleet(row,finance) as FleetRow; }
export const DATE_FIELDS = new Set(['rentStart','rentEnd','startDate','endDate','expectedReturn','actualReturn','violationDate','chargeDate','detectedDate','paidDate','dueDate','submittedDate','discountUntil','passageDate','requestDate','asOfDate','occurredAt']);
export function dbData(input: Record<string,unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([k,v]) => k !== 'version' && k !== 'allocationIds' && v !== undefined).map(([k,v]) => [k, DATE_FIELDS.has(k) && v ? new Date(String(v)) : v]));
}
