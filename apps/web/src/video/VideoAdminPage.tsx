import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Group, Loader, Menu, Modal, NumberInput, PasswordInput, ScrollArea, Select, Stack, Switch, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconPlus, IconSearch } from '@tabler/icons-react';
import { getRouteApi } from '@tanstack/react-router';
import { cameraSchema, recorderSchema, type CameraItem, type RecorderItem, type VideoAdmin } from '@mvs/shared';
import { api, ApiError } from '../api';
import { zodValidate } from '../ui/zodValidate';
import { VideoBoard } from './VideoBoard';
const route = getRouteApi('/app/admin/video');
export const videoAdminQuery = { queryKey: ['video', 'admin'], queryFn: () => api<VideoAdmin>('/video/admin/catalog'), refetchInterval: 20000 };

export function VideoAdminPage() {
  const { data, error, isLoading } = useQuery(videoAdminQuery);
  const search = route.useSearch(), navigate = route.useNavigate(), qc = useQueryClient();
  const [edit, setEdit] = useState<{ kind: 'recorders' | 'cameras'; item?: RecorderItem | CameraItem } | null>(null);
  const [archive, setArchive] = useState<{ kind: 'recorders' | 'cameras'; item: RecorderItem | CameraItem } | null>(null);
  const [preview, setPreview] = useState<CameraItem | null>(null), [result, setResult] = useState<string | null>(null);
  const set = (patch: Partial<typeof search>) => void navigate({ search: s => ({ ...s, ...patch }) });
  const write = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<{ message?: string }>(path, { method: 'POST', body }),
    onSuccess: async r => { setArchive(null); setResult(r?.message ?? 'Настройки сохранены. Результат синхронизации показан в реестре камер.'); await qc.invalidateQueries({ queryKey: ['video'] }); },
    onError: e => setResult(e.message),
  });
  const tab = search.tab ?? 'recorders';
  const sites = data?.sites ?? [], recorders = data?.recorders ?? [], cameras = data?.cameras ?? [];
  const matches = (row: RecorderItem | CameraItem, siteId: number) => (!search.site || siteId === search.site)
    && (search.archive === 'all' || (search.archive === 'archived' ? row.isArchived : !row.isArchived))
    && (!search.q || (row.name + ' ' + sites.find(s => s.id === siteId)?.name).toLowerCase().includes(search.q.toLowerCase()));
  const rowsR = recorders.filter(r => matches(r, r.siteId));
  const rowsC = cameras.filter(c => matches(c, c.siteId) && (!search.recorder || c.recorderId === search.recorder));
  const state = (item: RecorderItem | CameraItem) => item.isArchived ? 'Архив' : !item.enabled ? 'Отключена' : 'Включена';
  const menu = (item: RecorderItem | CameraItem, kind: 'recorders' | 'cameras') => <Menu position="bottom-end">
    <Menu.Target><ActionIcon aria-label={'Действия: ' + item.name} variant="subtle"><IconDots size={18} /></ActionIcon></Menu.Target>
    <Menu.Dropdown>
      {!item.isArchived && <Menu.Item onClick={() => setEdit({ item, kind })}>Изменить</Menu.Item>}
      {!item.isArchived && <Menu.Item onClick={() => {
        if (kind === 'cameras') setPreview(item as CameraItem);
        write.mutate({ path: '/video/' + kind + '/' + item.id + '/check' });
      }}>Проверить {kind === 'recorders' ? 'подключение' : 'изображение'}</Menu.Item>}
      {!item.isArchived && <Menu.Item onClick={() => {
        setResult(null);
        void api('/video/' + kind + '/' + item.id, { method: 'PUT', body: { ...item, enabled: !item.enabled } })
          .then(() => qc.invalidateQueries({ queryKey: ['video'] })).catch(e => setResult(e.message));
      }}>{item.enabled ? 'Отключить' : 'Включить'}</Menu.Item>}
      <Menu.Item color={item.isArchived ? undefined : 'red'} onClick={() => { write.reset(); setArchive({ item, kind }); }}>{item.isArchived ? 'Восстановить' : 'В архив'}</Menu.Item>
    </Menu.Dropdown>
  </Menu>;
  return <Stack gap="md">
    <Group justify="space-between"><Title order={2}>Видеонаблюдение</Title><Button leftSection={<IconPlus size={16} />} onClick={() => setEdit({ kind: tab })}>Добавить {tab === 'recorders' ? 'регистратор' : 'камеру'}</Button></Group>
    <Tabs value={tab} onChange={v => set({ tab: v === 'cameras' ? 'cameras' : 'recorders' })}><Tabs.List><Tabs.Tab value="recorders">Регистраторы · {recorders.length}</Tabs.Tab><Tabs.Tab value="cameras">Камеры · {cameras.length}</Tabs.Tab></Tabs.List></Tabs>
    <Group align="flex-end">
      <TextInput label="Поиск" placeholder="Название или объект" value={search.q ?? ''} onChange={e => set({ q: e.currentTarget.value })} leftSection={<IconSearch size={16} />} style={{ flex: '1 1 180px' }} />
      <Select label="Объект" placeholder="Все объекты" searchable clearable value={search.site ? String(search.site) : null} onChange={v => set({ site: v ? Number(v) : undefined, recorder: undefined })} data={sites.map(s => ({ value: String(s.id), label: s.name }))} style={{ flex: '1 1 180px' }} />
      {tab === 'cameras' && <Select label="Регистратор" placeholder="Все регистраторы" searchable clearable value={search.recorder ? String(search.recorder) : null} onChange={v => set({ recorder: v ? Number(v) : undefined })} data={recorders.filter(r => !search.site || r.siteId === search.site).map(r => ({ value: String(r.id), label: r.name }))} style={{ flex: '1 1 180px' }} />}
      <Select label="Состояние" value={search.archive ?? 'active'} allowDeselect={false} onChange={v => set({ archive: (v ?? 'active') as 'active' | 'archived' | 'all' })} data={[{ value: 'active', label: 'Действующие' }, { value: 'archived', label: 'Архив' }, { value: 'all', label: 'Все' }]} />
    </Group>
    {error && <Alert color="red">{error.message}</Alert>}
    {result && <Alert color="gray" withCloseButton onClose={() => setResult(null)}>{result}</Alert>}
    {isLoading ? <Loader size="sm" /> : <ScrollArea><Table highlightOnHover miw={tab === 'recorders' ? 900 : 850} verticalSpacing="sm">
      <Table.Thead><Table.Tr><Table.Th>Название</Table.Th><Table.Th>Объект</Table.Th>{tab === 'recorders' ? <><Table.Th>Адрес</Table.Th><Table.Th>Камер</Table.Th></> : <><Table.Th>Регистратор</Table.Th><Table.Th>Канал · поток</Table.Th></>}<Table.Th>Состояние</Table.Th><Table.Th>{tab === 'recorders' ? 'Проверка' : 'Синхронизация'}</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
      <Table.Tbody>{tab === 'recorders' ? rowsR.map(r => <Table.Tr key={r.id}><Table.Td fw={500}>{r.name}</Table.Td><Table.Td>{sites.find(s => s.id === r.siteId)?.name}</Table.Td><Table.Td>{r.host}:{r.port}</Table.Td><Table.Td>{r.cameraCount}</Table.Td><Table.Td><Badge variant="light" color="gray">{state(r)}</Badge></Table.Td><Table.Td><Text size="xs">{r.lastCheck === 'PORT_OPEN' ? 'Порт доступен' : r.lastCheck === 'NO_SIGNAL' ? 'Нет связи' : 'Не проверялся'}</Text>{r.lastCheckAt && <Text size="xs" c="dimmed">{new Date(r.lastCheckAt).toLocaleString('ru-RU')}</Text>}</Table.Td><Table.Td>{menu(r, 'recorders')}</Table.Td></Table.Tr>)
        : rowsC.map(c => <Table.Tr key={c.id}><Table.Td fw={500}>{c.name}</Table.Td><Table.Td>{sites.find(s => s.id === c.siteId)?.name}</Table.Td><Table.Td>{recorders.find(r => r.id === c.recorderId)?.name}</Table.Td><Table.Td>{c.channel} · {c.stream === 1 ? 'Дополнительный' : 'Основной'}</Table.Td><Table.Td><Badge variant="light" color="gray">{state(c)}</Badge>{!c.available && c.enabled && !c.isArchived && <Text size="xs" c="dimmed">Регистратор отключён</Text>}</Table.Td><Table.Td><Badge variant="light" color={c.syncState === 'ERROR' ? 'red' : 'gray'}>{c.syncState === 'SYNCED' ? 'Применено' : c.syncState === 'ERROR' ? 'Ошибка' : 'Ожидает'}</Badge>{c.syncError && <Text size="xs" c="red" maw={260}>{c.syncError}</Text>}{c.lastCheck && <Text size="xs" c="dimmed">{c.lastCheck === 'READY' ? 'Изображение проверено' : c.lastCheck === 'INCOMPATIBLE' ? 'Несовместимый формат' : 'Нет связи'}</Text>}</Table.Td><Table.Td>{menu(c, 'cameras')}</Table.Td></Table.Tr>)}
      </Table.Tbody>
    </Table>{!(tab === 'recorders' ? rowsR.length : rowsC.length) && <Text size="sm" c="dimmed" ta="center" py="xl">Записей по выбранным фильтрам нет</Text>}</ScrollArea>}
    <Modal opened={!!edit} onClose={() => setEdit(null)} title={edit?.item ? 'Изменить подключение' : tab === 'recorders' ? 'Добавить регистратор' : 'Добавить камеру'} size="lg">
      {edit && data && <EquipmentForm key={edit.kind + (edit.item?.id ?? 'new')} kind={edit.kind} item={edit.item} data={data} onDone={() => { setEdit(null); void qc.invalidateQueries({ queryKey: ['video'] }); }} />}
    </Modal>
    <Modal opened={!!archive} onClose={() => setArchive(null)} title={archive?.item.isArchived ? 'Восстановление' : 'Архивирование'} size="md">
      {archive && <Stack>{write.error && <Alert color="red">{write.error.message}</Alert>}<Text size="sm">{archive.item.name}</Text>{archive.kind === 'recorders' && !archive.item.isArchived && <>
        <Text size="sm">Будут приостановлены связанные камеры: {cameras.filter(c => c.recorderId === archive.item.id).length}. Их настройки сохранятся.</Text>
        <ScrollArea mah={220}><Stack gap={4}>{cameras.filter(c => c.recorderId === archive.item.id).map(c => <Text key={c.id} size="sm">{c.name} · канал {c.channel}{c.isArchived ? ' · архив' : !c.enabled ? ' · отключена' : ''}</Text>)}</Stack></ScrollArea>
      </>}{archive.item.isArchived && <Text size="sm" c="dimmed">Ранее отключённые и отдельно архивированные камеры сохранят своё состояние. Занятый канал нужно освободить перед восстановлением камеры.</Text>}
        <Group justify="flex-end"><Button variant="default" onClick={() => setArchive(null)}>Отмена</Button><Button color={archive.item.isArchived ? undefined : 'red'} loading={write.isPending} onClick={() => write.mutate({ path: '/video/' + archive.kind + '/' + archive.item.id + '/archive', body: { version: archive.item.version, isArchived: !archive.item.isArchived } })}>{archive.item.isArchived ? 'Восстановить' : 'В архив'}</Button></Group></Stack>}
    </Modal>
    <Modal opened={!!preview} onClose={() => setPreview(null)} title="Проверка изображения · Прямой эфир" size="lg">{preview && <Stack>{result && <Alert color="gray">{result}</Alert>}<VideoBoard cameras={[data?.cameras.find(c => c.id === preview.id) ?? preview]} /></Stack>}</Modal>
  </Stack>;
}
function EquipmentForm({ kind, item, data, onDone }: { kind: 'recorders' | 'cameras'; item?: RecorderItem | CameraItem; data: VideoAdmin; onDone(): void }) {
  const isRecorder = kind === 'recorders';
  const r = item as RecorderItem | undefined, c = item as CameraItem | undefined;
  const form = useForm({
    initialValues: { name: item?.name ?? '', siteId: isRecorder ? r?.siteId ?? data.sites[0]?.id ?? 0 : 0,
      host: isRecorder ? r?.host ?? '' : '', port: isRecorder ? r?.port ?? 554 : 554, username: isRecorder ? r?.username ?? '' : '', password: '',
      profile: 'DAHUA' as const, recorderId: !isRecorder ? c?.recorderId ?? data.recorders.find(r => !r.isArchived)?.id ?? 0 : 0,
      channel: !isRecorder ? c?.channel ?? 1 : 1, stream: !isRecorder ? c?.stream ?? 1 : 1, sort: !isRecorder ? c?.sort ?? 0 : 0, enabled: item?.enabled ?? true },
    validate: zodValidate(isRecorder ? recorderSchema : cameraSchema),
  });
  const mutation = useMutation({ mutationFn: () => api('/video/' + kind + (item ? '/' + item.id : ''), { method: item ? 'PUT' : 'POST', body: { ...form.values, version: item?.version } }), onSuccess: onDone,
    onError: e => { if (e instanceof ApiError) form.setErrors(e.fields); } });
  return <form onSubmit={form.onSubmit(() => mutation.mutate())}><Stack>
    <TextInput label="Название" required {...form.getInputProps('name')} />
    {isRecorder ? <>
      <Select label="Объект" searchable required data={data.sites.map(s => ({ value: String(s.id), label: s.name }))} value={String(form.values.siteId)} onChange={v => form.setFieldValue('siteId', Number(v))} error={form.errors.siteId} />
      <TextInput label="IPv4 или внутреннее DNS-имя" placeholder="Адрес регистратора в сети объекта" required {...form.getInputProps('host')} />
      <NumberInput label="RTSP-порт" min={1} max={65535} required {...form.getInputProps('port')} />
      <TextInput label="Логин просмотра" autoComplete="off" required {...form.getInputProps('username')} />
      <PasswordInput label={item ? 'Новый пароль' : 'Пароль'} description={item ? 'Пустое поле — оставить текущий пароль' : 'Отдельная учётная запись с правом просмотра каналов'} autoComplete="new-password" required={!item} {...form.getInputProps('password')} />
    </> : <>
      <Select label="Регистратор" searchable required data={data.recorders.filter(r => !r.isArchived).map(r => ({ value: String(r.id), label: r.name + ' · ' + data.sites.find(s => s.id === r.siteId)?.name }))} value={String(form.values.recorderId)} onChange={v => form.setFieldValue('recorderId', Number(v))} error={form.errors.recorderId} />
      <NumberInput label="Номер канала" description="От 1 до 16; номера могут идти с пропусками" min={1} max={16} required {...form.getInputProps('channel')} />
      <Select label="Поток" allowDeselect={false} data={[{ value: '1', label: 'Дополнительный — обычный просмотр' }, { value: '0', label: 'Основной — больше нагрузка' }]} value={String(form.values.stream)} onChange={v => form.setFieldValue('stream', v === '0' ? 0 : 1)} />
      <NumberInput label="Порядок отображения" min={0} max={10000} {...form.getInputProps('sort')} />
    </>}
    <Switch label="Включено" {...form.getInputProps('enabled', { type: 'checkbox' })} />
    {mutation.error && <Alert color="red">{mutation.error.message}</Alert>}
    <Group justify="flex-end"><Button type="submit" loading={mutation.isPending}>Сохранить</Button></Group>
  </Stack></form>;
}
