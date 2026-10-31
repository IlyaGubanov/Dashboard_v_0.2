import { z } from 'zod';
const id = z.number().int().positive();
const name = z.string().trim().min(1, 'Введите название').max(200);
export const recorderSchema = z.object({
  siteId: id, name,
  host: z.string().trim().min(1).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, 'Укажите IPv4 или внутреннее DNS-имя без протокола и порта'),
  port: z.number().int().min(1).max(65535).default(554),
  username: z.string().min(1, 'Введите логин').max(128), password: z.string().max(1024).optional(),
  profile: z.literal('DAHUA').default('DAHUA'), enabled: z.boolean().default(true), version: id.optional(),
});
export const cameraSchema = z.object({
  recorderId: id, name, channel: z.number().int().min(1).max(16),
  stream: z.union([z.literal(0), z.literal(1)]).default(1),
  sort: z.number().int().min(0).max(10000).default(0), enabled: z.boolean().default(true), version: id.optional(),
});
export const videoStateSchema = z.object({ version: id, isArchived: z.boolean() });
export const videoGrantsSchema = z.object({ grants: z.array(z.object({ siteId: id, manage: z.boolean() })).max(500) }).refine(v => new Set(v.grants.map(g => g.siteId)).size === v.grants.length, 'Объект указан дважды');
export type RecorderInput = z.infer<typeof recorderSchema>;
export type CameraInput = z.infer<typeof cameraSchema>;
export interface VideoSite { id: number; name: string; directionId: number; directionName: string; directionCode: string }
export interface RecorderItem {
  id: number; siteId: number; name: string; host: string; port: number; username: string; profile: 'DAHUA';
  enabled: boolean; isArchived: boolean; version: number; cameraCount: number;
  lastCheckAt: string | null; lastCheck: string | null; createdAt: string; updatedAt: string;
}
export interface CameraItem {
  id: number; recorderId: number; siteId: number; name: string; channel: number; stream: 0 | 1; sort: number;
  enabled: boolean; isArchived: boolean; version: number; available: boolean;
  syncState: string; syncError: string | null; lastCheck: string | null; lastCheckAt: string | null;
}
export interface VideoCatalog { sites: VideoSite[]; cameras: CameraItem[] }
export interface VideoAdmin extends VideoCatalog { recorders: RecorderItem[] }
export interface VideoCheck { status: 'READY' | 'NO_SIGNAL' | 'INCOMPATIBLE' | 'DISABLED' | 'SYNC_ERROR'; message: string; checkedAt: string }
