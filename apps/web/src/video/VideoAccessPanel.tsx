import { useState } from 'react';
import { Alert, Button, Checkbox, Group, Loader, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { videoAdminQuery } from './VideoAdminPage';
import { notifications } from '@mantine/notifications';
type Grant = { siteId: number; manage: boolean };
export function VideoAccessPanel({ userId, isAdmin }: { userId: number; isAdmin: boolean }) {
  const { data, error } = useQuery({ queryKey: ['video', 'grants', userId], queryFn: () => api<Grant[]>('/video/grants/' + userId) });
  const { data: catalog } = useQuery(videoAdminQuery);
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (!data || !catalog) return <Loader size="sm" />;
  return <GrantForm key={userId + ':' + JSON.stringify(data)} userId={userId} initial={data} sites={catalog.sites} isAdmin={isAdmin} />;
}
function GrantForm({ userId, initial, sites, isAdmin }: { userId: number; initial: Grant[]; sites: { id: number; name: string }[]; isAdmin: boolean }) {
  const activeSiteIds = new Set(sites.map(s => s.id));
  const removedArchived = initial.filter(g => !activeSiteIds.has(g.siteId)).length;
  const [grants, setGrants] = useState(() => initial.filter(g => activeSiteIds.has(g.siteId))), [q, setQ] = useState(''), [saved, setSaved] = useState(false);
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: () => api('/video/grants/' + userId, { method: 'PUT', body: { grants } }), onSuccess: async () => { notifications.show({ color: 'green', message: 'Доступ к камерам сохранён' }); await qc.invalidateQueries({ queryKey: ['me'] }); await qc.invalidateQueries({ queryKey: ['video'] }); setSaved(true); } });
  if (isAdmin) return <Alert color="gray">Администратору доступны все камеры и управление оборудованием. Остальным сотрудникам доступ выдаётся явно по объектам.</Alert>;
  return <Stack>
    {!!removedArchived && <Alert color="gray">Назначения на архивные объекты: {removedArchived}. При сохранении они будут сняты.</Alert>}
    <Text size="sm" c="dimmed">Просмотр и управление выдаются отдельно по каждому объекту. Для просмотра нужна роль в направлении; управление доступно руководству и кураторам. Область ввода производственных данных сюда не переносится.</Text>
    <TextInput label="Поиск объекта" value={q} onChange={e => setQ(e.currentTarget.value)} />
    <ScrollArea.Autosize mah={350} type="auto"><Table miw={430}><Table.Thead><Table.Tr><Table.Th>Объект</Table.Th><Table.Th>Просмотр</Table.Th><Table.Th>Управление</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
      {sites.filter(s => s.name.toLowerCase().includes(q.toLowerCase())).map(s => {
        const grant = grants.find(g => g.siteId === s.id);
        return <Table.Tr key={s.id}><Table.Td>{s.name}</Table.Td><Table.Td><Checkbox aria-label={'Просмотр: ' + s.name} checked={!!grant} onChange={e => { setSaved(false); setGrants(e.currentTarget.checked ? [...grants, { siteId: s.id, manage: false }] : grants.filter(g => g.siteId !== s.id)); }} /></Table.Td>
          <Table.Td><Checkbox aria-label={'Управление: ' + s.name} checked={grant?.manage ?? false} disabled={!grant} onChange={e => { setSaved(false); setGrants(grants.map(g => g.siteId === s.id ? { ...g, manage: e.currentTarget.checked } : g)); }} /></Table.Td></Table.Tr>;
      })}
    </Table.Tbody></Table></ScrollArea.Autosize>
    {save.error && <Alert color="red">{save.error.message}</Alert>}{saved && <Text size="sm">Доступ сохранён</Text>}
    <Group justify="flex-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Сохранить доступ к камерам</Button></Group>
  </Stack>;
}
