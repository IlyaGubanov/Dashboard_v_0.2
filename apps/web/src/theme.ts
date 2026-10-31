import { createTheme, defaultVariantColorsResolver, type MantineColorsTuple } from '@mantine/core';
import { DEFAULT_APPEARANCE, type Appearance } from '@mvs/shared';
import { mix } from './ui/color';

/** Ступени фирменного цвета, подобранные вручную для исходного оформления. */
const DEFAULT_BLUE: MantineColorsTuple = ['#edf6fd', '#dde4ed', '#c3ddef', '#9bcbeb', '#72add6', '#407faf', '#002f6c', '#00285c', '#00224f', '#001b40'];

/**
 * Десять ступеней основного цвета для Mantine: ступень 6 — основной цвет светлой темы, ступень 3 — тёмной
 * (см. primaryShade), остальные — смешение с белым, между ними и с чёрным.
 */
function primaryTuple(light: string, dark: string): MantineColorsTuple {
  if (light === DEFAULT_APPEARANCE.light.primary && dark === DEFAULT_APPEARANCE.dark.primary) return DEFAULT_BLUE;
  return [
    mix(dark, '#ffffff', 0.82),
    mix(dark, '#ffffff', 0.65),
    mix(dark, '#ffffff', 0.4),
    dark,
    mix(dark, light, 0.33),
    mix(dark, light, 0.66),
    light,
    mix(light, '#000000', 0.13),
    mix(light, '#000000', 0.28),
    mix(light, '#000000', 0.42),
  ];
}

/**
 * Тема приложения из настроек оформления (страница «Оформление» у администратора).
 * Цвета статусов, графиков и поверхностей — CSS-переменные (theme.css и ui/appearanceCss.ts),
 * чтобы графики и таблицы брали их из одного места и менялись вместе со светлой/тёмной темой.
 */
export function buildTheme(a: Appearance) {
  const fs = a.fontSize;
  const rem = (px: number) => `${px / 16}rem`;
  return createTheme({
    primaryColor: 'blue',
    autoContrast: true,
    variantColorResolver: (input) => {
      const colors = defaultVariantColorsResolver(input);
      // У фирменной кнопки разные ступени заливки в светлой и тёмной темах.
      return input.color === 'blue' && input.variant === 'filled' ? { ...colors, color: 'var(--brand-on-solid)' } : colors;
    },
    colors: {
      blue: primaryTuple(a.light.primary, a.dark.primary),
      dark: ['#e5edf6', '#c2cedd', '#a2b2c6', '#73849b', '#42526a', '#304158', '#233247', '#192639', '#132032', '#0e1929'],
    },
    primaryShade: { light: 6, dark: 3 },
    defaultRadius: 'sm',
    radius: { xs: rem(a.radius / 2), sm: rem(a.radius), md: rem(a.radius * 2), lg: rem(a.radius * 4), xl: rem(a.radius * 8) },
    fontFamily: `"${a.fontFamily}", "Segoe UI", Arial, sans-serif`,
    fontSizes: { xs: rem(fs - 2), sm: rem(fs - 1), md: rem(fs), lg: rem(fs + 2), xl: rem(fs + 4) },
    headings: {
      fontWeight: '650',
      sizes: { h1: { fontSize: rem(Math.round((fs * 24) / 14)) }, h2: { fontSize: rem(Math.round((fs * 22) / 14)) }, h3: { fontSize: rem(Math.round((fs * 18) / 14)) } },
    },
    components: {
      Button: { defaultProps: { fw: 600 } },
      Card: { defaultProps: { radius: 'sm', shadow: 'none' } },
      Paper: { defaultProps: { radius: 'sm' } },
      Table: { defaultProps: { horizontalSpacing: 'md', verticalSpacing: 'sm' } },
      Tabs: { defaultProps: { radius: 'sm' } },
      Tooltip: { defaultProps: { withArrow: true, multiline: true, maw: 320 } },
      Modal: { defaultProps: { closeButtonProps: { 'aria-label': 'Закрыть окно' } } },
      Drawer: { defaultProps: { closeButtonProps: { 'aria-label': 'Закрыть карточку' } } },
      PasswordInput: { defaultProps: { visibilityToggleButtonProps: { 'aria-label': 'Показать или скрыть пароль' } } },
    },
  });
}
