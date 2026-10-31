import { z } from 'zod';
import { CKKB_GROUPS, CKKB_TYPES, type CkkbGroup } from './ckkb';

/**
 * Замечания по объектам.
 *   OPEN → IN_PROGRESS → RESOLVED (исполнитель устранил) → VERIFIED (проверяющий принял);
 *   RESOLVED → OPEN (возврат на доработку), OPEN/IN_PROGRESS → REJECTED (снято), закрытое → OPEN (переоткрыть).
 */
export const REMARK_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'REJECTED'] as const;
export type RemarkStatus = (typeof REMARK_STATUSES)[number];
export const REMARK_STATUS_LABELS: Record<RemarkStatus, string> = {
  OPEN: 'Открыто',
  IN_PROGRESS: 'В работе',
  RESOLVED: 'Устранено, на проверке',
  VERIFIED: 'Принято',
  REJECTED: 'Снято',
};
/** Замечание ещё требует действий исполнителя. */
export const REMARK_ACTIVE: RemarkStatus[] = ['OPEN', 'IN_PROGRESS'];
export const REMARK_CLOSED: RemarkStatus[] = ['VERIFIED', 'REJECTED'];

export const REMARK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RemarkSeverity = (typeof REMARK_SEVERITIES)[number];
export const REMARK_SEVERITY_LABELS: Record<RemarkSeverity, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
  CRITICAL: 'Критическая',
};

/** Действия над замечанием. Кому что доступно — сервер возвращает в карточке (actions). */
export const REMARK_ACTIONS = ['start', 'resolve', 'verify', 'return', 'reject', 'reopen', 'comment'] as const;
export type RemarkAction = (typeof REMARK_ACTIONS)[number];
export const REMARK_ACTION_LABELS: Record<RemarkAction, string> = {
  start: 'Взять в работу',
  resolve: 'Устранено',
  verify: 'Принять',
  return: 'Вернуть на доработку',
  reject: 'Снять',
  reopen: 'Открыть снова',
  comment: 'Комментарий',
};
/** Действия, для которых комментарий обязателен. */
export const REMARK_TEXT_REQUIRED: RemarkAction[] = ['return', 'reject', 'reopen', 'comment'];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

export const remarkSchema = z.object({
  violationGroup: z.enum(CKKB_GROUPS).nullable().optional(),
  violationType: z.string().max(64).nullable().optional(),
  sourceName: z.string().trim().max(100).nullable().optional(),
  sourceRef: z.string().trim().max(300).nullable().optional(),
  detectedOn: isoDate.refine(v => !v || (Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v), 'Неверная дата'),
  typeName: z.string().trim().max(300).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  responsibleId: z.number().int().positive().nullable().optional(),
  siteId: z.number().int().positive({ message: 'Выберите объект' }),
  workItemId: z.number().int().positive().nullable().optional(),
  text: z.string().trim().min(3, 'Опишите замечание').max(5000),
  category: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  severity: z.enum(REMARK_SEVERITIES).default('MEDIUM'),
  dueDate: isoDate,
  assigneeId: z.number().int().positive().nullable().optional(),
  /** при правке — номер версии, которую видел пользователь */
  version: z.number().int().positive().optional(),
}).superRefine((v, ctx) => {
  if (v.violationGroup || v.violationType) {
    if (!v.violationGroup) ctx.addIssue({ code: 'custom', path: ['violationGroup'], message: 'Выберите группу нарушений ЦККБ' });
    if (!CKKB_TYPES.some(t => t.code === v.violationType && t.group === v.violationGroup)) ctx.addIssue({ code: 'custom', path: ['violationType'], message: 'Выберите тип из выбранной группы' });
  }
});
export type RemarkInput = z.input<typeof remarkSchema>;
export type RemarkData = z.output<typeof remarkSchema>;

export const remarkActionSchema = z
  .object({
    action: z.enum(REMARK_ACTIONS),
    text: z.string().trim().max(5000).optional(),
    /** статус, который видел пользователь: если замечание уже изменили — 409 */
    fromStatus: z.enum(REMARK_STATUSES),
  })
  .refine((a) => !REMARK_TEXT_REQUIRED.includes(a.action) || (a.text?.length ?? 0) > 0, { message: 'Напишите комментарий', path: ['text'] });
export type RemarkActionInput = z.input<typeof remarkActionSchema>;
export type RemarkActionData = z.output<typeof remarkActionSchema>;

export interface PersonRef {
  id: number;
  fullName: string;
}

export interface RemarkRow {
  violationGroup?: CkkbGroup | null;
  violationType?: string | null;
  sourceName?: string | null;
  sourceRef?: string | null;
  detectedOn?: string | null;
  typeName?: string | null;
  location?: string | null;
  responsible?: PersonRef | null;
  id: number;
  num: number;
  site: { id: number; name: string };
  workItem: { id: number; name: string } | null;
  text: string;
  category: string | null;
  severity: RemarkSeverity;
  status: RemarkStatus;
  dueDate: string | null;
  overdue: boolean;
  author: PersonRef | null;
  assignee: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  photos: number;
  isExample: boolean;
}

export interface Attachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  uploadedBy: string | null;
  createdAt: string;
  canArchive: boolean;
}

export interface RemarkEvent {
  id: number;
  kind: 'CREATE' | 'STATUS' | 'EDIT' | 'COMMENT';
  fromStatus: RemarkStatus | null;
  toStatus: RemarkStatus | null;
  text: string | null;
  author: string | null;
  createdAt: string;
  files: Attachment[];
  /** автор может приложить к своему событию фото ещё сутки */
  canAttach: boolean;
}

export interface RemarkCard extends RemarkRow {
  version: number;
  resolvedBy: string | null;
  resolvedAt: string | null;
  events: RemarkEvent[];
  actions: RemarkAction[];
  canEdit: boolean;
}

export interface RemarkList {
  rows: RemarkRow[];
  canCreate: boolean;
  /** объекты, по которым пользователь может добавить замечание */
  sites: { id: number; name: string }[];
  /** исполнители: участники направления и люди, назначенные на объекты */
  people: PersonRef[];
  categories: string[];
}

/** Вложения: что разрешено загружать. Изображения больше 2000 px клиент уменьшает перед загрузкой. */
export const ATTACHMENT_MAX_MB = 25;
export const ATTACHMENT_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z', 'dwg'] as const;
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXT.map((e) => `.${e}`).join(',');
export type AttachmentEntity = 'site' | 'remark_event';
