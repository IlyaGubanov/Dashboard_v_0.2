import { createTheme } from '@mantine/core';

/**
 * Единая тема приложения. Цвета статусов и светофора — в theme.css (CSS-переменные),
 * чтобы графики и таблицы брали их из одного места и менялись вместе со светлой/тёмной темой.
 */
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'Inter, "Segoe UI", Roboto, Arial, sans-serif',
  headings: { fontWeight: '600' },
});
