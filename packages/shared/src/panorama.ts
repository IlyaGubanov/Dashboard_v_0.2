import { z } from 'zod';
const capturedOn=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Дата съёмки в формате ГГГГ-ММ-ДД').refine(v=>Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v,'Неверная дата съёмки');
export const attachmentMaterialSchema=z.discriminatedUnion('materialType',[
  z.object({materialType:z.literal('FILE')}),
  z.object({materialType:z.literal('PANORAMA360'),capturedOn,description:z.string().trim().max(1000).optional()}),
]);
export type AttachmentMaterial=z.infer<typeof attachmentMaterialSchema>;
