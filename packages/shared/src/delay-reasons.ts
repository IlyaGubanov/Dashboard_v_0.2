import { z } from 'zod';

const ids = z.array(z.number().int().positive()).max(100).refine(v => new Set(v).size === v.length, 'Сотрудник указан дважды');
export const delayReasonSettingsSchema = z.object({
  defaultResponsibleIds: ids.default([]),
  useSiteResponsibles: z.boolean().default(true),
  allowCuratorEdit: z.boolean().default(true),
  requireWhenDelayed: z.boolean().default(false),
  workTypes: z.array(z.object({ workTypeId: z.number().int().positive(), responsibleIds: ids }).strict()).max(1000).default([]),
}).strict().refine(v => new Set(v.workTypes.map(w => w.workTypeId)).size === v.workTypes.length, 'Вид работ указан дважды');
export type DelayReasonSettings = z.output<typeof delayReasonSettingsSchema>;
export const delayReasonSaveSchema = z.object({ text: z.string().trim().max(2000), version: z.number().int().min(0) }).strict();
export type DelayReasonSave = z.infer<typeof delayReasonSaveSchema>;

export function delayResponsibleIds(s: DelayReasonSettings, workTypeId: number, siteIds: number[]): number[] {
  const override = s.workTypes.find(w => w.workTypeId === workTypeId);
  return [...new Set(override ? override.responsibleIds : s.defaultResponsibleIds.length ? s.defaultResponsibleIds : s.useSiteResponsibles ? siteIds : [])];
}
export function canEditDelayReason(s: DelayReasonSettings, role: string | null, userId: number, responsibleIds: number[], status: string): boolean {
  if (role === 'ADMIN') return true;
  if (status === 'LOCKED') return false;
  if (role === 'CURATOR' && s.allowCuratorEdit) return true;
  return status === 'OPEN' && responsibleIds.includes(userId);
}
export interface DelayReasonRow {
  workItemId: number;
  siteId: number;
  workTypeId: number;
  name: string;
  siteName: string;
  periodId: number | null;
  periodDate: string | null;
  program: string;
  text: string;
  version: number;
  from: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  responsibles: { id: number; fullName: string }[];
  canEdit: boolean;
  required: boolean;
  delayed: boolean;
}
export interface DelayReasonsSheet { rows: DelayReasonRow[] }
export interface DelayReasonAdmin {
  settings: DelayReasonSettings;
  users: { id: number; fullName: string }[];
  workTypes: { id: number; name: string }[];
}
