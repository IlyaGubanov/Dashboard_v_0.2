import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { Alert } from '@mantine/core';
import { ApiError, directionsQuery, meQuery } from './api';
import { canSee } from './ui/access';
import { AppLayout } from './layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { OverviewPage } from './pages/OverviewPage';
import { DirectionPage } from './pages/DirectionPage';
import { parseDirectionSearch } from './pages/direction/search';
import { UsersPage } from './pages/UsersPage';
import { AdminDirectionsPage } from './pages/admin/AdminDirectionsPage';
import { DirectionEditorPage } from './pages/admin/DirectionEditorPage';
import { HelpPage } from './pages/HelpPage';
import { ContractorsPage } from './pages/ContractorsPage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

/** Текущий пользователь или null, если не вошёл. */
async function loadMe(qc: QueryClient) {
  try {
    return await qc.ensureQueryData(meQuery);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>) => ({ next: typeof s.next === 'string' ? s.next : undefined }),
  component: LoginPage,
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  beforeLoad: async ({ context }) => {
    if (!(await loadMe(context.queryClient))) throw redirect({ to: '/login', search: { next: undefined } });
  },
  component: ChangePasswordPage,
});

/** Всё, что ниже, — только после входа. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: '/login', search: { next: location.href } });
    if (me.mustChangePassword) throw redirect({ to: '/change-password' });
    return { me };
  },
  component: AppLayout,
});

/** Главная — сводка; если она скрыта у сотрудника, открывается первое доступное направление. */
const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    if (canSee(context.me, 'overview')) return;
    const dirs = await context.queryClient.ensureQueryData(directionsQuery);
    if (dirs[0]) throw redirect({ to: '/d/$code', params: { code: dirs[0].code }, search: {} });
  },
  component: HomePage,
});

function HomePage() {
  const me = queryClient.getQueryData(meQuery.queryKey);
  if (canSee(me, 'overview')) return <OverviewPage />;
  return <Alert color="gray">Доступных разделов пока нет. Обратитесь к администратору.</Alert>;
}

const directionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/d/$code',
  // вкладка, дата и открытый объект — в адресе: ссылкой можно поделиться, «назад» работает
  validateSearch: parseDirectionSearch,
  component: DirectionPage,
});

const adminOnly = ({ context }: { context: { queryClient: QueryClient } }) => {
  const me = context.queryClient.getQueryData(meQuery.queryKey);
  if (me?.globalRole !== 'ADMIN') throw redirect({ to: '/' });
};

const usersRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/users', beforeLoad: adminOnly, component: UsersPage });
const adminDirectionsRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/directions', beforeLoad: adminOnly, component: AdminDirectionsPage });
const directionEditorRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/directions/$code', beforeLoad: adminOnly, component: DirectionEditorPage });

const contractorsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contractors',
  beforeLoad: ({ context }) => {
    if (!canSee(context.me, 'contractors')) throw redirect({ to: '/' });
  },
  component: ContractorsPage,
});

const helpRoute = createRoute({ getParentRoute: () => appRoute, path: '/help', component: HelpPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  changePasswordRoute,
  appRoute.addChildren([overviewRoute, directionRoute, usersRoute, adminDirectionsRoute, directionEditorRoute, contractorsRoute, helpRoute]),
]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
