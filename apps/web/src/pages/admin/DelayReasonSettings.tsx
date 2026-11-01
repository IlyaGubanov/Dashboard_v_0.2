import { useState } from 'react';
import { Alert, Button, Checkbox, Group, MultiSelect, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DelayReasonAdmin, DelayReasonSettings as Settings } from '@mvs/shared';
import { api } from '../../api';

export function DelayReasonSettings({ code }: { code: string }) {
  const q = useQuery({ queryKey: ['admin', 'direction', code, 'delay-reasons'], queryFn: () => api<DelayReasonAdmin>(`/admin/directions/${code}/delay-reasons`) });
  if (q.error) return <Alert color="red">{q.error.message}</Alert>;
  if (!q.data) return <Skeleton h={240} />;
  return <SettingsForm code={code} data={q.data} />;
}
function SettingsForm({ code, data }: { code: string; data: DelayReasonAdmin }) {
  const [draft, setDraft] = useState<Settings | null>(null), [search, setSearch] = useState('');
  const v = draft ?? data.settings;
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: () => api(`/admin/directions/${code}/delay-reasons`, { method: 'PUT', body: v }), onSuccess: async () => { await qc.invalidateQueries(); setDraft(null); } });
  const patch = (p: Partial<Settings>) => setDraft({ ...v, ...p });
  const options = data.users.map(u => ({ value: String(u.id), label: u.fullName }));
  const activeIds = new Set(data.users.map(u => u.id));
  const assignedOptions = (ids: number[]) => [...options, ...ids.filter(id => !activeIds.has(id)).map(id => ({ value: String(id), label: `Сотрудник №${id} — доступ отозван, удалите назначение` }))];
  return <Stack gap="md" className="delay-reason-settings">
    <Text size="sm">Поле «Причина отставания от графика» отображается под каждой работой во всех направлениях. Назначайте активных участников направления. Изменение назначения сразу меняет ФИО и права заполнения.</Text>
    <MultiSelect label="Ответственные по умолчанию" description="Для всех видов работ без отдельного назначения" searchable clearable data={assignedOptions(v.defaultResponsibleIds)} value={v.defaultResponsibleIds.map(String)} onChange={ids => patch({ defaultResponsibleIds: ids.map(Number) })} />
    <Checkbox label="Если общие ответственные не выбраны, использовать ответственных позиции и объекта" checked={v.useSiteResponsibles} onChange={e => patch({ useSiteResponsibles: e.currentTarget.checked })} />
    <Checkbox label="Разрешить куратору редактировать причины" checked={v.allowCuratorEdit} onChange={e => patch({ allowCuratorEdit: e.currentTarget.checked })} />
    <Checkbox label="Требовать причину при отставании перед закрытием отчётной точки" checked={v.requireWhenDelayed} onChange={e => patch({ requireWhenDelayed: e.currentTarget.checked })} />
    <Text size="xs" c="dimmed">Назначенные сотрудники заполняют причины в открытой точке. Куратор с разрешением может править закрытую точку; заблокированную — администратор. Причины ведутся отдельно от импортированных объёмов.</Text>
    <Group justify="space-between"><Text fw={600} size="sm">Назначения по видам работ</Text><TextInput aria-label="Поиск вида работ" placeholder="Поиск вида работ" value={search} onChange={e => setSearch(e.currentTarget.value)} /></Group>
    {data.workTypes.filter(t => t.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))).map(t => {
      const override = v.workTypes.find(w => w.workTypeId === t.id);
      return <Stack key={t.id} gap={6} py="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Checkbox label={`${t.name} — отдельное назначение`} checked={!!override} onChange={e => patch({ workTypes: e.currentTarget.checked ? [...v.workTypes, { workTypeId: t.id, responsibleIds: [] }] : v.workTypes.filter(w => w.workTypeId !== t.id) })} />
        {override && <MultiSelect label={`Ответственные: ${t.name}`} searchable clearable data={assignedOptions(override.responsibleIds)} value={override.responsibleIds.map(String)} onChange={ids => patch({ workTypes: v.workTypes.map(w => w.workTypeId === t.id ? { ...w, responsibleIds: ids.map(Number) } : w) })} />}
        {override && !override.responsibleIds.length && <Text size="xs" c="dimmed">Ответственные не назначены. Общее назначение для этого вида работ не применяется.</Text>}
      </Stack>;
    })}
    {!data.workTypes.length && <Text c="dimmed" size="sm">Виды работ пока не созданы. Общее назначение будет применяться к новым работам.</Text>}
    {save.error && <Alert color="red">{save.error.message}</Alert>}
    {save.isSuccess && !draft && <Text role="status" size="sm">Настройки сохранены</Text>}
    <Group><Button loading={save.isPending} disabled={!draft} onClick={() => save.mutate()}>Сохранить настройки причин</Button><Button variant="default" disabled={!draft || save.isPending} onClick={() => setDraft(null)}>Отменить</Button></Group>
  </Stack>;
}
