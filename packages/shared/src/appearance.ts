import { z } from 'zod';

/**
 * Оформление приложения: название в шапке, шрифт, размеры и цвета светлой и тёмной тем.
 * Настраивает администратор (страница «Оформление»), действует для всех пользователей и на странице входа.
 */

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет вида #002f6c');

/** Цвета одной темы. Ключи совпадают с CSS-переменными в theme.css (series1 → --series-1). */
export const APPEARANCE_COLORS = [
  'primary',
  'canvas',
  'panel',
  'surfaceMuted',
  'selected',
  'ink',
  'muted',
  'line',
  'navCaption',
  'good',
  'warning',
  'critical',
  'none',
  'series1',
  'series2',
  'series3',
  'track',
  'planMark',
  'tileBg',
  'tileAccent',
] as const;
export type AppearanceColor = (typeof APPEARANCE_COLORS)[number];

/** Подписи и группы для формы: что красит каждый цвет. */
export const APPEARANCE_COLOR_INFO: Record<AppearanceColor, { label: string; hint: string; group: 'base' | 'text' | 'status' | 'charts' | 'tiles' }> = {
  primary: { label: 'Основной (фирменный)', hint: 'Кнопки, ссылки, выбранный пункт меню и вкладка', group: 'base' },
  canvas: { label: 'Фон страницы', hint: 'Подложка под карточками', group: 'base' },
  panel: { label: 'Карточки и панели', hint: 'Карточки, шапка, меню, окна, поля ввода', group: 'base' },
  surfaceMuted: { label: 'Приглушённый фон', hint: 'Шапки таблиц, плитки показателей, наведение на строку', group: 'base' },
  selected: { label: 'Выбранное', hint: 'Активный пункт меню, вкладка, строка под курсором', group: 'base' },
  ink: { label: 'Основной текст', hint: 'Заголовки и обычный текст', group: 'text' },
  muted: { label: 'Подписи', hint: 'Пояснения, единицы, даты', group: 'text' },
  line: { label: 'Линии и рамки', hint: 'Границы карточек, таблиц и полей', group: 'text' },
  navCaption: { label: 'Подпись под направлением в меню', hint: '«4 школ», «42 адреса» в левом меню', group: 'text' },
  good: { label: 'В графике', hint: 'Состояние «в графике», «выполнено»', group: 'status' },
  warning: { label: 'Отставание', hint: 'Состояние «отставание»', group: 'status' },
  critical: { label: 'Критично', hint: 'Состояние «критично», просрочка', group: 'status' },
  none: { label: 'Нет данных', hint: 'Без графика, не начато', group: 'status' },
  series1: { label: 'График — серия 1', hint: 'Факт, первая линия и столбец', group: 'charts' },
  series2: { label: 'График — серия 2', hint: 'Вторая линия и столбец', group: 'charts' },
  series3: { label: 'График — серия 3', hint: 'Третья линия и столбец', group: 'charts' },
  track: { label: 'Полоса готовности — фон', hint: 'Незаполненная часть полосы «факт / план»', group: 'charts' },
  planMark: { label: 'Отметка плана', hint: 'Черта плана на полосе готовности, линия плана на графике', group: 'charts' },
  tileBg: { label: 'Фон плитки', hint: 'Плитки показателей на вкладке «Обзор» направления', group: 'tiles' },
  tileAccent: { label: 'Полоса или рамка плитки', hint: 'Если у плитки не задан свой цвет в конструкторе', group: 'tiles' },
};

export const APPEARANCE_GROUP_LABELS = { base: 'Фон и основной цвет', text: 'Текст и линии', status: 'Состояния', charts: 'Графики и полосы', tiles: 'Плитки показателей' } as const;

const paletteSchema = z.object(Object.fromEntries(APPEARANCE_COLORS.map((k) => [k, hex])) as Record<AppearanceColor, typeof hex>);
export type AppearancePalette = z.infer<typeof paletteSchema>;

/** Шрифты, которые обычно уже есть на компьютерах (внешние шрифтовые сервисы не подключаются). */
export const APPEARANCE_FONTS = ['Montserrat', 'Segoe UI', 'Arial', 'Roboto', 'Verdana', 'Tahoma', 'Calibri', 'PT Sans', 'Open Sans'] as const;

/** Вид плиток показателей: полоса слева, рамка вокруг, заливка без рамки. */
export const TILE_STYLES = ['stripe', 'border', 'fill'] as const;
export const TILE_STYLE_LABELS: Record<(typeof TILE_STYLES)[number], string> = { stripe: 'Полоса слева', border: 'Рамка', fill: 'Заливка' };

/** Подпись под направлением в левом меню. */
export const NAV_CAPTIONS = ['count', 'name', 'none'] as const;
export const NAV_CAPTION_LABELS: Record<(typeof NAV_CAPTIONS)[number], string> = { count: 'Число объектов', name: 'Полное название', none: 'Без подписи' };

export const appearanceSchema = z.object({
  brandName: z.string().trim().min(1, 'Укажите название').max(80, 'До 80 символов'),
  brandCaption: z.string().trim().max(120, 'До 120 символов'),
  fontFamily: z
    .string()
    .trim()
    .min(1, 'Укажите шрифт')
    .max(60, 'До 60 символов')
    .regex(/^[\p{L}\p{N} _-]+$/u, 'Только название шрифта: буквы, цифры, пробел, «-»'),
  /** базовый размер текста, px */
  fontSize: z.number().int().min(12, 'От 12 до 18').max(18, 'От 12 до 18'),
  /** размер текста на страницах направлений (все вкладки, карточки объектов и замечаний), px — для всех направлений, в том числе новых */
  directionFontSize: z.number().int().min(12, 'От 12 до 24').max(24, 'От 12 до 24'),
  /** скругление углов карточек и кнопок, px */
  radius: z.number().int().min(0, 'От 0 до 16').max(16, 'От 0 до 16'),
  tiles: z.object({
    style: z.enum(TILE_STYLES),
    /** размер числа, px */
    valueSize: z.number().int().min(14, 'От 14 до 36').max(36, 'От 14 до 36'),
    /** размер подписи, px */
    labelSize: z.number().int().min(10, 'От 10 до 16').max(16, 'От 10 до 16'),
    /** плиток в ряду на широком экране */
    columns: z.number().int().min(2, 'От 2 до 6').max(6, 'От 2 до 6'),
  }),
  nav: z.object({
    caption: z.enum(NAV_CAPTIONS),
    /** размер подписи, px */
    captionSize: z.number().int().min(10, 'От 10 до 14').max(14, 'От 10 до 14'),
  }),
  light: paletteSchema,
  dark: paletteSchema,
});
export type Appearance = z.infer<typeof appearanceSchema>;

/** Исходное оформление (брендбук МосводостокСтройТрест) — то же, что в theme.css. */
export const DEFAULT_APPEARANCE: Appearance = {
  brandName: 'МосводостокСтройТрест',
  brandCaption: 'Информационно-аналитическая система',
  fontFamily: 'Montserrat',
  fontSize: 14,
  // в направлениях — крупнее остального приложения: там много чисел и таблиц
  directionFontSize: 16,
  radius: 4,
  tiles: { style: 'stripe', valueSize: 16, labelSize: 12, columns: 4 },
  nav: { caption: 'count', captionSize: 11 },
  light: {
    primary: '#002f6c',
    canvas: '#f1f4f8',
    panel: '#ffffff',
    surfaceMuted: '#edf2f7',
    selected: '#edf6fd',
    ink: '#192c43',
    muted: '#53647a',
    line: '#d5dee8',
    navCaption: '#53647a',
    good: '#44883e',
    warning: '#ae5600',
    critical: '#c8102e',
    none: '#68788d',
    series1: '#002f6c',
    series2: '#b65a00',
    series3: '#00837e',
    track: '#e5ebf2',
    planMark: '#53647a',
    tileBg: '#edf2f7',
    tileAccent: '#d5dee8',
  },
  dark: {
    primary: '#9bcbeb',
    canvas: '#101b2b',
    panel: '#192639',
    surfaceMuted: '#233247',
    selected: '#253e58',
    ink: '#e5edf6',
    muted: '#aebed1',
    line: '#3a4b62',
    navCaption: '#aebed1',
    good: '#91ca88',
    warning: '#ffb366',
    critical: '#ff8498',
    none: '#a2b2c6',
    series1: '#9bcbeb',
    series2: '#ffb366',
    series3: '#73ccc7',
    track: '#304158',
    planMark: '#c2cedd',
    tileBg: '#233247',
    tileAccent: '#3a4b62',
  },
};

/** Сохранённое значение поверх исходного: недостающие поля (например, после добавления нового цвета) — из исходного. */
export function mergeAppearance(v: unknown): Appearance {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Appearance>;
  const merged = {
    ...DEFAULT_APPEARANCE,
    ...o,
    tiles: { ...DEFAULT_APPEARANCE.tiles, ...(o.tiles ?? {}) },
    nav: { ...DEFAULT_APPEARANCE.nav, ...(o.nav ?? {}) },
    light: { ...DEFAULT_APPEARANCE.light, ...(o.light ?? {}) },
    dark: { ...DEFAULT_APPEARANCE.dark, ...(o.dark ?? {}) },
  };
  const r = appearanceSchema.safeParse(merged);
  return r.success ? r.data : DEFAULT_APPEARANCE;
}
