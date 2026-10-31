import './zodConfig';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { queryClient, router } from './router';
import { AppearanceProvider } from './ui/appearance';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* оформление (тема Mantine и цвета) — из настроек администратора */}
      <AppearanceProvider>
        <Notifications position="top-right" />
        <RouterProvider router={router} />
      </AppearanceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
