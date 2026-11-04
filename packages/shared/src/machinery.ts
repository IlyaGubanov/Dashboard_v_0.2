/** Техника по видам: что внёс ответственный за объект, что распределено в РЭБ и как они сходятся. */
import { z } from 'zod';

/** Общие названия видов: по ним сверяются данные ответственного и РЭБ. */
export const MACHINERY_KINDS = [
  { category: 'Землеройная техника', kinds: ['Экскаватор', 'Экскаватор-погрузчик', 'Мини-экскаватор', 'Бульдозер', 'Фронтальный погрузчик'] },
  { category: 'Подъёмная техника', kinds: ['Автокран', 'Автовышка', 'Манипулятор', 'Телескопический погрузчик'] },
  { category: 'Грузовой транспорт', kinds: ['Самосвал', 'Бортовой грузовик', 'Тягач с тралом', 'Микроавтобус'] },
  { category: 'Дорожная техника', kinds: ['Каток', 'Автогрейдер', 'Асфальтоукладчик', 'Поливомоечная машина'] },
  { category: 'Специальная техника', kinds: ['Илосос', 'Каналопромывочная машина', 'ГНБ-установка', 'Автобетоносмеситель', 'Автобетононасос'] },
  { category: 'Малая механизация', kinds: ['Виброплита', 'Вибротрамбовка', 'Мотопомпа', 'Дизель-генератор', 'Компрессор', 'Бетономешалка', 'Отбойный молоток', 'Глубинный вибратор'] },
] as const;

export const machineryLineSchema = z.object({
  kind: z.string().trim().min(1, 'Укажите вид техники').max(100, 'Не больше 100 символов'),
  qty: z.number().int('Только целое число').min(1, 'Количество от 1').max(100000),
});
export type MachineryLine = z.infer<typeof machineryLineSchema>;

/** Строка для журнала изменений: «Самосвал — 2, Экскаватор — 1». */
export const machineryText = (lines: MachineryLine[] | null | undefined) => (lines?.length ? lines.map((l) => `${l.kind} — ${l.qty}`).join(', ') : null);

export const MACHINERY_STATUS = {
  match: 'Совпадает',
  diff: 'Разное количество',
  kinds: 'Разные виды',
  onlyReport: 'Только ответственный',
  onlyFleet: 'Только РЭБ',
  none: 'Нет данных',
} as const;
export type MachineryStatus = keyof typeof MACHINERY_STATUS;

export interface MachineryKindDiff {
  kind: string;
  reported: number | null;
  fleet: number;
}

export interface MachineryVehicle {
  id: number;
  name: string;
  kind: string;
  category: string | null;
  plate: string | null;
  inventoryNumber: string | null;
  technicalState: string;
  ownership: string;
}

export interface MachineryRow {
  siteId: number;
  siteName: string;
  direction: { code: string; shortName: string };
  /** null — сотруднику закрыт раздел РЭБ, сверка не показывается */
  status: MachineryStatus | null;
  reported: {
    total: number | null;
    /** null — ответственный внёс только общее число */
    byKind: MachineryLine[] | null;
    /** кто внёс; null — не указано или закрыт справочник сотрудников */
    by: string | null;
    at: string | null;
    /** дата отчётной точки, с которой взято значение */
    from: string | null;
  };
  /** null — сотруднику закрыт раздел РЭБ */
  fleet: {
    total: number;
    byKind: MachineryLine[];
    by: string[];
    at: string | null;
    /** null — виден только итог по видам, без конкретных машин */
    vehicles: MachineryVehicle[] | null;
  } | null;
  /** сравнение по каждому виду; пусто, если виды у ответственного не указаны */
  kinds: MachineryKindDiff[];
}

export interface MachineryView {
  asOf: string | null;
  rows: MachineryRow[];
  summary: Record<MachineryStatus, number>;
  /** техника, распределённая на направление без указания объекта */
  fleetWithoutSite: number;
}
