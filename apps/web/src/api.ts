import { queryOptions } from '@tanstack/react-query';
import type { ObjectsMap } from '@mvs/shared';

export const objectsMapQuery = queryOptions({ queryKey: ['map'], queryFn: () => api<ObjectsMap>('/map'), staleTime: 0, refetchInterval: 60_000 });
import type {
  AuditPage,
  ContractorsView,
  EntrySheet,
  ManageRefs,
  SiteEdit,
  DirectionKpi,
  DirectionSummary,
  DynamicsPoint,
  Me,
  MyTasks,
  Overview,
  PeopleView,
  PeriodItem,
  RemarkCard,
  RemarkList,
  SiteCard,
  SiteKpiRow,
  TrackersView,
  UserListItem,
  DepartmentItem,
  WorkGrid,
} from '@mvs/shared';

/** Ошибка API: сообщение, ошибки по полям (для форм) и код. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
    public code?: string,
    /** что именно конфликтует при одновременной правке */
    public conflicts: string[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

  let data: { message?: string | string[]; fields?: Record<string, string>; code?: string; conflicts?: string[] } = {};
  try {
    data = await res.json();
  } catch {
    /* ответ без тела */
  }
  const msg = Array.isArray(data.message) ? data.message.join('; ') : data.message;
  throw new ApiError(res.status, msg || `Ошибка ${res.status}`, data.fields, data.code, data.conflicts);
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api<Me>('/auth/me'),
  staleTime: 60_000,
  retry: false,
});

export const directionsQuery = queryOptions({
  queryKey: ['directions'],
  queryFn: () => api<DirectionSummary[]>('/directions'),
  staleTime: 60_000,
});

/** Производственная сводка; обновляется сама раз в 5 минут, пока страница открыта. */
export const overviewQuery = queryOptions({
  queryKey: ['overview'],
  queryFn: () => api<Overview>('/overview'),
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
});

const q = (date?: string) => (date ? `?date=${date}` : '');

/** Данные направления на дату среза (date не задана — последняя отчётная точка). */
export const directionQueries = {
  kpi: (code: string, date?: string) =>
    queryOptions({ queryKey: ['dir', code, 'kpi', date ?? ''], queryFn: () => api<DirectionKpi>(`/directions/${code}/kpi${q(date)}`), staleTime: 60_000 }),
  sites: (code: string, date?: string) =>
    queryOptions({ queryKey: ['dir', code, 'sites', date ?? ''], queryFn: () => api<SiteKpiRow[]>(`/directions/${code}/sites${q(date)}`), staleTime: 60_000 }),
  dynamics: (code: string, date?: string) =>
    queryOptions({ queryKey: ['dir', code, 'dyn', date ?? ''], queryFn: () => api<DynamicsPoint[]>(`/directions/${code}/dynamics${q(date)}`), staleTime: 60_000 }),
  periods: (code: string) =>
    queryOptions({ queryKey: ['dir', code, 'periods'], queryFn: () => api<PeriodItem[]>(`/directions/${code}/periods`), staleTime: 60_000 }),
  grid: (code: string, date?: string) =>
    queryOptions({ queryKey: ['dir', code, 'grid', date ?? ''], queryFn: () => api<WorkGrid>(`/directions/${code}/grid${q(date)}`), staleTime: 60_000 }),
  trackers: (code: string) =>
    queryOptions({ queryKey: ['dir', code, 'trackers'], queryFn: () => api<TrackersView>(`/directions/${code}/trackers`), staleTime: 60_000 }),
  people: (code: string) =>
    queryOptions({ queryKey: ['dir', code, 'people'], queryFn: () => api<PeopleView>(`/directions/${code}/people`), staleTime: 60_000 }),
  entry: (code: string, periodId: number) =>
    queryOptions({ queryKey: ['dir', code, 'entry', periodId], queryFn: () => api<EntrySheet>(`/directions/${code}/entry/${periodId}`), staleTime: 0 }),
  audit: (code: string, p: { skip: number; take: number; from?: string; to?: string; siteId?: number }) =>
    queryOptions({
      queryKey: ['dir', code, 'audit', p],
      queryFn: () =>
        api<AuditPage>(
          `/directions/${code}/audit?${new URLSearchParams(
            Object.entries(p)
              .filter(([, v]) => v != null && v !== '')
              .map(([k, v]) => [k, String(v)]),
          )}`,
        ),
    }),
  manage: (code: string) =>
    queryOptions({ queryKey: ['dir', code, 'manage'], queryFn: () => api<ManageRefs>(`/directions/${code}/manage`), staleTime: 30_000 }),
  siteEdit: (code: string, id: number) =>
    queryOptions({ queryKey: ['dir', code, 'site-edit', id], queryFn: () => api<SiteEdit>(`/directions/${code}/manage/sites/${id}`), staleTime: 0 }),
  remarks: (code: string) =>
    queryOptions({ queryKey: ['dir', code, 'remarks'], queryFn: () => api<RemarkList>(`/directions/${code}/remarks`), staleTime: 30_000 }),
  remark: (code: string, id: number) =>
    queryOptions({ queryKey: ['dir', code, 'remark', id], queryFn: () => api<RemarkCard>(`/directions/${code}/remarks/${id}`), staleTime: 0 }),
  site: (code: string, id: number, date?: string) =>
    queryOptions({ queryKey: ['dir', code, 'site', id, date ?? ''], queryFn: () => api<SiteCard>(`/directions/${code}/sites/${id}${q(date)}`), staleTime: 60_000 }),
};

/** Напоминания пользователю; обновляются раз в 5 минут и при возврате на вкладку. */
export const myTasksQuery = queryOptions({
  queryKey: ['me', 'tasks'],
  queryFn: () => api<MyTasks>('/me/tasks'),
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
});

/** Подрядчики по всем доступным направлениям. */
export const contractorsQuery = queryOptions({
  queryKey: ['contractors'],
  queryFn: () => api<ContractorsView>('/contractors'),
  staleTime: 60_000,
});

export const usersQuery = queryOptions({
  queryKey: ['users'],
  queryFn: () => api<UserListItem[]>('/users'),
});

/** Справочник подразделений (вместе с архивными). */
export const departmentsQuery = queryOptions({
  queryKey: ['departments'],
  queryFn: () => api<DepartmentItem[]>('/departments'),
});
