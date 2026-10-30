import { z } from 'zod';
import {
  GLOBAL_ROLES,
  MEMBER_ROLES,
  MEMBER_SCOPES,
  passwordSchema,
  type GlobalRole,
  type MemberRole,
  type MemberScope,
} from './auth';
import { APP_SECTIONS, FEATURES, type AccessRestrictions } from './access';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Телефон: цифры, пробелы, + ( ) - и «доб. 123»; не меньше 5 цифр. Пусто — нет телефона. */
const phoneSchema = optionalText(50).refine(
  (v) => v == null || (/^[\d\s+().,-]+((доб|ext)\.?\s*\d+)?$/i.test(v) && (v.match(/\d/g)?.length ?? 0) >= 5),
  'Номер телефона: цифры, пробелы и знаки + ( ) -, например +7 (495) 123-45-67',
);

const departmentId = z.number().int().positive().nullable().optional();
const hiddenSections = z
  .array(z.enum(APP_SECTIONS))
  .max(APP_SECTIONS.length)
  .transform((a) => [...new Set(a)]);
const deniedFeatures = z
  .array(z.enum(FEATURES))
  .max(FEATURES.length)
  .transform((a) => [...new Set(a)]);

export const userCreateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Укажите ФИО').max(200),
    position: optionalText(200),
    departmentId,
    email: z.union([z.literal(''), z.email('Неверный e-mail')]).nullable().optional(),
    phone: phoneSchema,
    globalRole: z.enum(GLOBAL_ROLES).default('USER'),
    hiddenSections: hiddenSections.default([]),
    deniedFeatures: deniedFeatures.default([]),
    canLogin: z.boolean().default(true),
    login: z
      .string()
      .trim()
      .min(3, 'Не короче 3 символов')
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Латиница, цифры, точка, дефис, подчёркивание')
      .optional(),
    password: passwordSchema.optional(),
  })
  .refine((u) => !u.canLogin || (u.login && u.password), {
    message: 'Для входа в систему нужны логин и пароль',
    path: ['login'],
  });
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserCreateData = z.output<typeof userCreateSchema>;

/** Правка карточки сотрудника: передаются только изменяемые поля. */
export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите ФИО').max(200).optional(),
  position: optionalText(200),
  departmentId,
  email: z.union([z.literal(''), z.email('Неверный e-mail')]).nullable().optional(),
  phone: phoneSchema,
  globalRole: z.enum(GLOBAL_ROLES).optional(),
  isActive: z.boolean().optional(),
  hiddenSections: hiddenSections.optional(),
  deniedFeatures: deniedFeatures.optional(),
});
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
export type UserUpdateData = z.output<typeof userUpdateSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });

/** Роль в направлении. Ограничение по лотам/объектам имеет смысл только для ответственного за ввод. */
export const membershipSchema = z
  .object({
    directionId: z.number().int().positive(),
    role: z.enum(MEMBER_ROLES),
    scope: z.enum(MEMBER_SCOPES).default('ALL'),
    sectionIds: z.array(z.number().int().positive()).default([]),
  })
  .transform((m) =>
    m.role === 'EDITOR'
      ? { ...m, sectionIds: m.scope === 'SECTIONS' ? m.sectionIds : [] }
      : { ...m, scope: 'ALL' as const, sectionIds: [] },
  )
  .refine((m) => m.scope !== 'SECTIONS' || m.sectionIds.length > 0, {
    message: 'Выберите хотя бы один лот или раздел',
    path: ['sectionIds'],
  });
export type MembershipInput = z.input<typeof membershipSchema>;
export type MembershipData = z.output<typeof membershipSchema>;

export interface UserListItem extends AccessRestrictions {
  id: number;
  login: string | null;
  fullName: string;
  position: string | null;
  department: { id: number; name: string } | null;
  email: string | null;
  phone: string | null;
  globalRole: GlobalRole;
  canLogin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  /** вход заблокирован после неудачных попыток до этого момента */
  lockedUntil: string | null;
  memberships: {
    directionId: number;
    directionName: string;
    role: MemberRole;
    scope: MemberScope;
    sectionIds: number[];
  }[];
}

/**
 * Загрузка пользователей списком (из Excel/CSV). Ячейки передаются как есть, сервер сам распознаёт роли,
 * направления и лоты и возвращает по каждой строке, что будет сделано. Один человек в нескольких направлениях —
 * несколько строк с одинаковым логином (или ФИО, если логина нет).
 */
export const IMPORT_FIELDS = [
  { key: 'fullName', label: 'ФИО', aliases: ['фио', 'сотрудник', 'фамилия имя отчество', 'фамилия'] },
  { key: 'login', label: 'Логин', aliases: ['логин', 'login', 'учетная запись', 'учётная запись'] },
  { key: 'position', label: 'Должность', aliases: ['должность'] },
  { key: 'department', label: 'Подразделение', aliases: ['подразделение', 'отдел', 'служба'] },
  { key: 'email', label: 'E-mail', aliases: ['e-mail', 'email', 'почта', 'электронная почта'] },
  { key: 'phone', label: 'Телефон', aliases: ['телефон', 'тел'] },
  { key: 'globalRole', label: 'Роль в системе', aliases: ['роль в системе', 'системная роль'] },
  { key: 'direction', label: 'Направление', aliases: ['направление'] },
  { key: 'role', label: 'Роль в направлении', aliases: ['роль в направлении', 'роль'] },
  { key: 'sections', label: 'Лоты', aliases: ['лоты', 'лот', 'разделы'] },
  { key: 'canLogin', label: 'Вход', aliases: ['вход', 'может входить'] },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];

export const userImportSchema = z.object({
  dryRun: z.boolean(),
  rows: z.array(z.record(z.string(), z.string().max(1000))).min(1, 'Нет строк').max(2000, 'Не больше 2000 строк за раз'),
});
export type UserImportInput = z.input<typeof userImportSchema>;

export interface UserImportRow {
  /** номер строки в файле (первая строка данных — 2, как в Excel под заголовком) */
  line: number;
  fullName: string;
  login: string | null;
  status: 'create' | 'update' | 'error';
  /** что будет сделано / ошибки */
  messages: string[];
  /** роли по направлениям, человеческим языком */
  roles: string[];
  /** временный пароль — только в ответе на загрузку (не при проверке) и только для новых учётных записей */
  password?: string;
}

export interface UserImportResult {
  dryRun: boolean;
  rows: UserImportRow[];
  created: number;
  updated: number;
  errors: number;
}
