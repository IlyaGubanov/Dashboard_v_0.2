import { z } from 'zod';
import { CKKB_GROUPS, CKKB_TYPES } from './ckkb';
const count = z.number().int().min(0).max(100_000_000).nullable();
const quantity = z.number().finite().min(0).max(1e15).nullable();
/** Сводка источника по организации/городу, а не выдуманные показатели отдельных объектов. */
export const reportSummarySchema = z.object({
  scope: z.enum(['ORGANIZATION', 'CITY']),
  organization: z.string().trim().min(1, 'Укажите организацию или территорию сводки').max(200),
  source: z.string().trim().min(1, 'Укажите источник сводки').max(300),
  page: z.number().int().min(1).max(10000).nullable(),
  areaHa: quantity,
  objects: z.object({ total: count, scheduled: count, started: count, completed: count, commissioned: count }),
  resources: z.object({ people: count, tech: count }),
  systems: z.array(z.object({ code: z.enum(['ELECTRICITY','ASUDD','OOT']), planned: count, completed: count, inProgress: count, notStarted: count })).max(3),
  volumes: z.array(z.object({ name: z.string().trim().min(1).max(200), unit: z.string().trim().min(1).max(30), plan: quantity, fact: quantity, remaining: quantity, delta: z.number().finite().min(-1e15).max(1e15).nullable() })).max(100),
  violations: z.array(z.object({ group: z.enum(CKKB_GROUPS), type: z.string().max(64).nullable(), total: count, resolved: count, controlled: count })
    .refine(v => !v.type || CKKB_TYPES.some(t => t.code === v.type && t.group === v.group), 'Тип нарушения не относится к группе')).max(150),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export const reportSummarySaveSchema = z.object({ version: z.number().int().min(0), value: reportSummarySchema });
export type ReportSummarySave = z.infer<typeof reportSummarySaveSchema>;
export const reportSummaryStoredSchema = z.object({ version: z.number().int().positive(), value: reportSummarySchema });
export type ReportSummaryStored = z.infer<typeof reportSummaryStoredSchema>;
