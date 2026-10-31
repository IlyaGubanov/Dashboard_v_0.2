import { Alert, Badge, Group, Loader, Select, Stack, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { VideoCatalog } from '@mvs/shared';
import { api } from '../api';
import { VideoBoard } from './VideoBoard';
export const videoQuery = { queryKey: ['video', 'catalog'], queryFn: () => api<VideoCatalog>('/video/catalog'), refetchInterval: 20000 };
export function SiteCameras({ siteId }: { siteId: number }) {
  const { data, isLoading, error } = useQuery(videoQuery);
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (isLoading) return <Loader size="sm" />;
  return <Stack><Group><Badge variant="light" color="gray">Прямой эфир</Badge></Group><VideoBoard cameras={data?.cameras.filter(c => c.siteId === siteId) ?? []} /></Stack>;
}
const route = getRouteApi('/app/video');
export function VideoPage() {
  const { data, error, isLoading } = useQuery(videoQuery);
  const search = route.useSearch(), navigate = route.useNavigate();
  const set = (patch: Partial<typeof search>) => void navigate({ search: s => ({ ...s, ...patch }) });
  const sites = data?.sites ?? [];
  const scoped = sites.filter(s => !search.direction || s.directionCode === search.direction);
  const cameras = data?.cameras.filter(c => (!search.site || c.siteId === search.site) && scoped.some(s => s.id === c.siteId)
    && (!search.q || (c.name + ' ' + sites.find(s => s.id === c.siteId)?.name).toLowerCase().includes(search.q.toLowerCase()))) ?? [];
  return <Stack gap="md">
    <Group justify="space-between"><Title order={2}>Видеонаблюдение</Title><Badge color="gray" variant="light">Прямой эфир</Badge></Group>
    <Group align="flex-end">
      <TextInput label="Поиск" placeholder="Камера или объект" leftSection={<IconSearch size={16} />} value={search.q ?? ''} onChange={e => set({ q: e.currentTarget.value })} style={{ flex: '1 1 200px' }} />
      <Select label="Направление" placeholder="Все направления" clearable value={search.direction ?? null} onChange={v => set({ direction: v ?? undefined, site: undefined })}
        data={[...new Map(sites.map(s => [s.directionCode, { value: s.directionCode, label: s.directionName }])).values()]} style={{ flex: '1 1 200px' }} />
      <Select label="Объект" placeholder="Все объекты" searchable clearable value={search.site ? String(search.site) : null} onChange={v => set({ site: v ? Number(v) : undefined })}
        data={scoped.map(s => ({ value: String(s.id), label: s.name }))} style={{ flex: '1 1 200px' }} />
    </Group>
    {error && <Alert color="red">{error.message}</Alert>}
    {isLoading ? <Loader size="sm" /> : <VideoBoard key={[search.direction, search.site, search.q].join(':')} cameras={cameras} names={Object.fromEntries(sites.map(s => [s.id, s.name]))} />}
  </Stack>;
}
