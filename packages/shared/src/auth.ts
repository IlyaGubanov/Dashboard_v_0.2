import { z } from 'zod';
import type { AccessRestrictions } from './access';

export const GLOBAL_ROLES = ['ADMIN', 'MANAGEMENT', 'USER'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  ADMIN: 'Администратор',
  MANAGEMENT: 'Руководство',
  USER: 'Сотрудник',
};

export const MEMBER_ROLES = ['CURATOR', 'EDITOR', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  CURATOR: 'Куратор направления',
  EDITOR: 'Ответственный за ввод',
  VIEWER: 'Просмотр',
};

export const MEMBER_SCOPES = ['ALL', 'SECTIONS', 'SITES'] as const;
export type MemberScope = (typeof MEMBER_SCOPES)[number];

export const MEMBER_SCOPE_LABELS: Record<MemberScope, string> = {
  ALL: 'Всё направление',
  SECTIONS: 'Выбранные лоты / разделы',
  SITES: 'Только назначенные объекты',
};

/** Требования к паролю: от 10 символов, буквы и цифры. */
export const passwordSchema = z
  .string()
  .min(10, 'Не короче 10 символов')
  .max(128, 'Не длиннее 128 символов')
  .regex(/\p{L}/u, 'Нужна хотя бы одна буква')
  .regex(/\d/, 'Нужна хотя бы одна цифра');

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Введите логин').max(64),
  password: z.string().min(1, 'Введите пароль').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface DirectionAccess {
  directionId: number;
  code: string;
  role: MemberRole;
  scope: MemberScope;
  sectionIds: number[];
}

/**
 * Текущий пользователь, как его видит клиент (GET /api/auth/me).
 * hiddenSections / deniedFeatures — что скрыто у сотрудника (у администратора всегда пусто).
 */
export interface Me extends AccessRestrictions {
  fleetRole?: MemberRole | 'ADMIN' | null;
  id: number;
  login: string;
  fullName: string;
  position: string | null;
  globalRole: GlobalRole;
  mustChangePassword: boolean;
  directions: DirectionAccess[];
  videoAccess: { view: boolean; manage: boolean };
}
