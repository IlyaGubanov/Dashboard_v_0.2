import { useMemo, useState } from 'react';
import { Accordion, Alert, Group, Skeleton, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { DelayReasonRow } from '@mvs/shared';
import { meQuery } from '../../api';
import { DelayReasonField, useDelayReasons } from './DelayReasonField';

/** Единая форма доступна и назначенному сотруднику с ролью просмотра/импортным направлением. */
export function DelayReasonsTab({ code, date }: { code: string; date?: string }) {
  const q = useDelayReasons(code, date), { data: me } = useQuery(meQuery);
  const [search, setSearch] = useState(''), [delayed, setDelayed] = useState(false), [missing, setMissing] = useState(false), [mine, setMine] = useState(false);
  const [opened, setOpened] = useState<string[] | null>(null);
  const sites = useMemo(() => {
    const groups = new Map<number, { name: string; rows: DelayReasonRow[] }>();
    const text = search.trim().toLocaleLowerCase('ru');
    for (const r of q.data?.rows ?? []) {
      if ((delayed && !r.delayed) || (missing && r.text.trim()) || (mine && !r.responsibles.some(u => u.id === me?.id))) continue;
      if (text && ![r.siteName, r.name, r.text, ...r.responsibles.map(u => u.fullName)].join(' ').toLocaleLowerCase('ru').includes(text)) continue;
      const group = groups.get(r.siteId) ?? { name: r.siteName, rows: [] }; group.rows.push(r); groups.set(r.siteId, group);
    }
    return [...groups];
  }, [q.data, search, delayed, missing, mine, me?.id]);
  if (q.error) return <Alert color="red">{q.error.message}</Alert>;
  if (!q.data) return <Skeleton h={240} />;
  const shownOpen = opened ?? sites.slice(0, 1).map(([id]) => String(id));
  return <Stack gap="sm">
    <Group gap="sm"><TextInput aria-label="Поиск работ и ответственных" placeholder="Объект, работа или ФИО" value={search} onChange={e => setSearch(e.currentTarget.value)} style={{ flex: '1 1 220px' }} />
      <Switch label="Только мои" checked={mine} onChange={e => setMine(e.currentTarget.checked)} />
      <Switch label="С отставанием" checked={delayed} onChange={e => setDelayed(e.currentTarget.checked)} />
      <Switch label="Без причины" checked={missing} onChange={e => setMissing(e.currentTarget.checked)} />
    </Group>
    <Text size="xs" c="dimmed">Найдено объектов: {sites.length}. Причины сохраняются отдельной кнопкой под каждой работой. Черновики сохраняются в этой вкладке браузера при переходах между разделами.</Text>
    <Accordion multiple variant="separated" value={shownOpen} onChange={setOpened}>
      {sites.map(([id, site]) => <Accordion.Item key={id} value={String(id)}>
        <Accordion.Control>{site.name} · {site.rows.length} работ</Accordion.Control>
        <Accordion.Panel>{shownOpen.includes(String(id)) && <Stack gap="sm">{site.rows.map(row => <div key={`${row.workItemId}-${row.periodId}`}><Text size="sm" fw={600}>{row.name}</Text><DelayReasonField code={code} row={row} /></div>)}</Stack>}</Accordion.Panel>
      </Accordion.Item>)}
    </Accordion>
    {!sites.length && <Text size="sm" c="dimmed">Работ по выбранным условиям нет.</Text>}
  </Stack>;
}
