import { z } from 'zod';

/**
 * Разделы, которые администратор может скрыть у сотрудника (галочки в карточке сотрудника).
 * Скрытие только сужает то, что дают роли: вкладки «Ввод данных» и «Управление» по-прежнему зависят от роли в направлении,
 * «Обзор» направления виден всегда. Администратору скрытие не применяется.
 */
export const APP_SECTIONS = ['overview', 'contractors', 'sites', 'matrix', 'schedule', 'trackers', 'dynamics', 'map', 'remarks', 'people', 'settings', 'fleet'] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

export const APP_SECTION_LABELS: Record<AppSection, string> = {
  overview: 'Производственная сводка',
  contractors: 'Подрядчики',
  sites: 'Объекты',
  matrix: 'Матрица',
  schedule: 'График работ',
  trackers: 'Надстройки',
  dynamics: 'Динамика',
  map: 'Карта',
  remarks: 'Замечания',
  people: 'Ответственные',
  settings: 'Устройство',
  fleet: 'РЭБ — техника и эксплуатация',
};

/** Группы для формы: разделы меню и вкладки направления. */
export const APP_SECTION_GROUPS: { label: string; sections: AppSection[] }[] = [
  { label: 'Меню', sections: ['overview', 'contractors', 'map', 'fleet'] },
  { label: 'Вкладки направления', sections: ['sites', 'matrix', 'schedule', 'trackers', 'dynamics', 'remarks', 'people', 'settings'] },
];

/** Отдельные возможности, которые можно отключить сотруднику. */
export const FEATURES = ['finance', 'remarksCreate', 'export', 'audit'] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, { label: string; description: string }> = {
  finance: { label: 'Видеть финансы', description: 'Стоимость, КС-2, оплата, авансы, лимиты. Без галочки сервер не отдаёт денежные данные.' },
  remarksCreate: { label: 'Создавать замечания', description: 'Заводить новые замечания по объектам (если есть права на объект).' },
  export: { label: 'Выгрузка в Excel', description: 'Кнопки выгрузки реестров в CSV для Excel.' },
  audit: { label: 'Журнал изменений', description: 'Вкладка «Журнал» и история: кто и что поменял.' },
};

/** Что скрыто у сотрудника. Пустые списки — всё, что позволяют роли. */
export interface AccessRestrictions {
  hiddenSections: AppSection[];
  deniedFeatures: Feature[];
}

/** Разбор значения из базы (JSON): неизвестные ключи отбрасываются. */
export function parseRestrictions(hiddenSections: unknown, deniedFeatures: unknown): AccessRestrictions {
  const list = <T extends string>(v: unknown, allowed: readonly T[]) => (Array.isArray(v) ? v.filter((x): x is T => allowed.includes(x as T)) : []);
  return { hiddenSections: list(hiddenSections, APP_SECTIONS), deniedFeatures: list(deniedFeatures, FEATURES) };
}

/** Подразделение (справочник). */
export const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Не короче 2 символов').max(200, 'Не длиннее 200 символов'),
  isArchived: z.boolean().optional(),
});
export type DepartmentInput = z.input<typeof departmentSchema>;
export type DepartmentData = z.output<typeof departmentSchema>;

export interface DepartmentItem {
  id: number;
  name: string;
  isArchived: boolean;
  /** сотрудников в подразделении */
  users: number;
}
