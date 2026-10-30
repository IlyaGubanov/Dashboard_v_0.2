import { createTheme } from '@mantine/core';

/**
 * Единая тема приложения. Цвета статусов и светофора — в theme.css (CSS-переменные),
 * чтобы графики и таблицы брали их из одного места и менялись вместе со светлой/тёмной темой.
 */
export const theme = createTheme({
  primaryColor: 'blue',
  colors: {
    blue: ['#edf6fd', '#dde4ed', '#c3ddef', '#9bcbeb', '#72add6', '#407faf', '#002f6c', '#00285c', '#00224f', '#001b40'],
    dark: ['#e5edf6', '#c2cedd', '#a2b2c6', '#73849b', '#42526a', '#304158', '#233247', '#192639', '#132032', '#0e1929'],
  },
  primaryShade: { light: 6, dark: 3 },
  defaultRadius: 'sm',
  fontFamily: 'Montserrat, "Segoe UI", Arial, sans-serif',
  fontSizes: { xs: '0.75rem', sm: '0.8125rem', md: '0.875rem', lg: '1rem', xl: '1.125rem' },
  headings: { fontWeight: '650', sizes: { h1: { fontSize: '1.5rem' }, h2: { fontSize: '1.375rem' }, h3: { fontSize: '1.125rem' } } },
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
