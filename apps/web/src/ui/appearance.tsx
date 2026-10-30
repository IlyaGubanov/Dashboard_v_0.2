import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  APPEARANCE_COLORS,
  appearanceSchema,
  DEFAULT_APPEARANCE,
  mergeAppearance,
  type Appearance,
  type AppearanceColor,
  type AppearancePalette,
} from '@mvs/shared';
import { api } from '../api';
import { buildTheme } from '../theme';
import { bestOn } from './color';

/** Последнее полученное оформление хранится в браузере: при следующем открытии нет мигания исходных цветов. */
const STORAGE_KEY = 'mvs.appearance';

function cached(): Appearance | undefined {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? mergeAppearance(JSON.parse(s)) : undefined;
  } catch {
    return undefined;
  }
}

export const appearanceQuery = queryOptions({
  queryKey: ['appearance'],
  queryFn: async () => {
    const a = mergeAppearance(await api<Appearance>('/appearance'));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
    } catch {
      /* браузер не даёт сохранять — просто без кеша */
    }
    return a;
  },
  staleTime: 5 * 60_000,
});

/** Цвет из настроек → CSS-переменная (те же имена, что в theme.css). */
const CSS_VARS: Record<Exclude<AppearanceColor, 'primary'>, string> = {
  canvas: '--canvas',
  panel: '--panel',
  surfaceMuted: '--surface-muted',
  selected: '--selected',
  ink: '--ink',
  muted: '--muted',
  line: '--line',
  navCaption: '--nav-caption',
  good: '--status-good',
  warning: '--status-warning',
  critical: '--status-critical',
  none: '--status-none',
  series1: '--series-1',
  series2: '--series-2',
  series3: '--series-3',
  track: '--track',
  planMark: '--plan-mark',
  tileBg: '--tile-bg',
  tileAccent: '--tile-accent',
};

function vars(p: AppearancePalette, onDark: string) {
  const lines = Object.entries(CSS_VARS).map(([k, v]) => `${v}: ${p[k as keyof typeof CSS_VARS]};`);
  lines.push(`--brand-royal: ${p.primary};`, `--brand-on-solid: ${bestOn(p.primary, ['#ffffff', onDark])};`);
  return lines.join(' ');
}

/** Вид плиток показателей; --tile-color — свой цвет плитки из конструктора направления. */
const TILE_CSS = {
  stripe: '',
  border: '.direction-metric.direction-metric { border: 1px solid var(--tile-color, var(--tile-accent)); border-radius: var(--mantine-radius-sm); }',
  fill:
    '.direction-metric.direction-metric { border: 0; border-radius: var(--mantine-radius-sm); }\n' +
    '.direction-metric.direction-metric[data-colored] { background: color-mix(in srgb, var(--tile-color) 14%, var(--tile-bg)); }',
} as const;

/**
 * Размер текста на страницах направлений: переопределяет размеры шрифта Mantine внутри .direction-page
 * (страница направления, её карточки и окна). --text-scale — множитель для крупных чисел, плиток и графиков.
 */
function directionCss(d: number) {
  const rem = (px: number) => `${Math.round(px * 100) / 1600}rem`;
  const h = (px: number) => rem(Math.round((d * px) / 14));
  return (
    `.direction-page { --text-scale: ${Math.round((d / 14) * 1000) / 1000}; ` +
    `--mantine-font-size-xs: ${rem(d - 2)}; --mantine-font-size-sm: ${rem(d - 1)}; --mantine-font-size-md: ${rem(d)}; ` +
    `--mantine-font-size-lg: ${rem(d + 2)}; --mantine-font-size-xl: ${rem(d + 4)}; ` +
    `--mantine-h1-font-size: ${h(24)}; --mantine-h2-font-size: ${h(22)}; --mantine-h3-font-size: ${h(18)}; ` +
    `--mantine-h4-font-size: ${h(18)}; --mantine-h5-font-size: ${h(16)}; --mantine-h6-font-size: ${h(14)}; ` +
    `font-size: var(--mantine-font-size-md); }`
  );
}

/** Переопределения theme.css: селекторы сильнее, чем в нём, поэтому порядок подключения не важен. */
export function appearanceCss(a: Appearance) {
  return [
    `:root:root { ${vars(a.light, a.light.ink)} --nav-caption-size: ${a.nav.captionSize}px; }`,
    `:root:root[data-mantine-color-scheme='dark'] { ${vars(a.dark, a.dark.canvas)} }`,
    directionCss(a.directionFontSize),
    `.direction-metric .tile-value { font-size: calc(${a.tiles.valueSize}px * var(--text-scale, 1)); }`,
    `.direction-metric .tile-label { font-size: calc(${a.tiles.labelSize}px * var(--text-scale, 1)); }`,
    TILE_CSS[a.tiles.style],
  ].join('\n');
}

/**
 * Черновик для показа во всём приложении: поле, которое сейчас набирают с ошибкой (например, неполный цвет),
 * берётся из сохранённого, чтобы приложение не теряло цвета на время ввода.
 */
export function forPreview(v: Appearance, fallback: Appearance): Appearance {
  const s = appearanceSchema.shape;
  const ok = <K extends keyof Appearance>(k: K) => (s[k].safeParse(v[k]).success ? v[k] : fallback[k]);
  const palette = (p: AppearancePalette, f: AppearancePalette) =>
    Object.fromEntries(APPEARANCE_COLORS.map((k) => [k, /^#[0-9a-fA-F]{6}$/.test(p[k]) ? p[k] : f[k]])) as AppearancePalette;
  return {
    brandName: ok('brandName'),
    brandCaption: ok('brandCaption'),
    fontFamily: ok('fontFamily'),
    fontSize: ok('fontSize'),
    directionFontSize: ok('directionFontSize'),
    radius: ok('radius'),
    tiles: ok('tiles'),
    nav: ok('nav'),
    light: palette(v.light, fallback.light),
    dark: palette(v.dark, fallback.dark),
  };
}

type DraftUpdate = Appearance | null | ((cur: Appearance) => Appearance);

interface Ctx {
  /** действующее оформление: черновик администратора, если он есть, иначе сохранённое */
  appearance: Appearance;
  saved: Appearance;
  /** несохранённый черновик со страницы «Оформление» (null — нет); виден только этому администратору */
  draft: Appearance | null;
  /** изменить черновик; null или совпадение с сохранённым — черновика нет */
  setDraft: (u: DraftUpdate) => void;
}

const AppearanceContext = createContext<Ctx>({ appearance: DEFAULT_APPEARANCE, saved: DEFAULT_APPEARANCE, draft: null, setDraft: () => undefined });

export const useAppearance = () => useContext(AppearanceContext);

/** Применяет оформление: тема Mantine, CSS-переменные цветов, заголовок вкладки браузера. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data: saved = DEFAULT_APPEARANCE } = useQuery({ ...appearanceQuery, initialData: cached, initialDataUpdatedAt: 0 });
  const [draft, setDraftState] = useState<Appearance | null>(null);
  const setDraft = useCallback(
    (u: DraftUpdate) =>
      setDraftState((cur) => {
        const next = typeof u === 'function' ? u(cur ?? saved) : u;
        return next && JSON.stringify(next) !== JSON.stringify(saved) ? next : null;
      }),
    [saved],
  );
  const appearance = useMemo(() => (draft ? forPreview(draft, saved) : saved), [draft, saved]);
  const theme = useMemo(() => buildTheme(appearance), [appearance]);
  const css = useMemo(() => appearanceCss(appearance), [appearance]);
  const ctx = useMemo(() => ({ appearance, saved, draft, setDraft }), [appearance, saved, draft, setDraft]);

  useEffect(() => {
    document.title = appearance.brandName;
  }, [appearance.brandName]);

  // черновик живёт до перезагрузки страницы — браузер переспросит перед закрытием
  useEffect(() => {
    if (!draft) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);

  return (
    <AppearanceContext.Provider value={ctx}>
      <style>{css}</style>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        {children}
      </MantineProvider>
    </AppearanceContext.Provider>
  );
}
