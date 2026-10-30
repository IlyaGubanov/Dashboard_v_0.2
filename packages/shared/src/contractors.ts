import { z } from 'zod';
import type { SiteRisk } from './kpi';
import { organizationSchema } from './manage';

export const CONTRACTOR_KINDS = ['CONTRACTOR', 'SUBCONTRACTOR'] as const;
export type ContractorKind = (typeof CONTRACTOR_KINDS)[number];

/** Объект подрядчика в сводном списке. */
export interface ContractorSite {
  directionCode: string;
  siteId: number;
  name: string;
  /** general — подрядчик объекта, items — подрядчик отдельных позиций */
  role: 'general' | 'items';
  fact: number | null;
  plan: number | null;
  lag: number | null;
  risk: SiteRisk;
}

/**
 * Подрядчик по всем направлениям. Справочник организаций свой у каждого направления;
 * здесь записи одной организации собраны вместе — по ИНН, а без ИНН — по названию.
 */
export interface ContractorRow {
  key: string;
  name: string;
  inn: string | null;
  kinds: ContractorKind[];
  directions: { code: string; shortName: string; color: string | null; orgId: number; sites: number }[];
  sites: ContractorSite[];
  lagging: number;
  critical: number;
}

export interface ContractorsView {
  rows: ContractorRow[];
  /** направления, доступные пользователю; canManage — может добавлять подрядчиков */
  directions: { code: string; shortName: string; color: string | null; canManage: boolean }[];
}

/** Подрядчик сразу в несколько направлений. */
export const contractorCreateSchema = organizationSchema.extend({
  kind: z.enum(CONTRACTOR_KINDS),
  directions: z.array(z.string().min(1).max(32)).min(1, 'Выберите хотя бы одно направление').max(100),
});
export type ContractorCreateInput = z.input<typeof contractorCreateSchema>;
export type ContractorCreateData = z.output<typeof contractorCreateSchema>;
