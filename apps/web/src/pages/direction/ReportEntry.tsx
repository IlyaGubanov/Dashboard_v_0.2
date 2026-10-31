import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, directionQueries, directionsQuery, meQuery } from '../../api';
import { EntryTab } from './EntryTab';

/** Программы берутся из настроек и реальных отчётных периодов. */
export function ReportEntry({ code }: { code: string }) {
  const config = useQuery({ queryKey: ['dir', code, 'config'], queryFn: () => api<{ settings: { programs?: Record<string, string> } | null }>(`/directions/${code}/config`) });
  const { data: periods } = useQuery(directionQueries.periods(code));
  const { data: dirs } = useQuery(directionsQuery), { data: me } = useQuery(meQuery);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null), [dirty, setDirty] = useState(false), [opened, setOpened] = useState(false), [date, setDate] = useState('');
  const names = config.data?.settings?.programs ?? {};
  const codes = [...new Set([...Object.keys(names), ...(periods ?? []).map(p => p.program)])];
  const program = selected != null && codes.includes(selected) ? selected : codes[0] ?? '';
  const own = (periods ?? []).filter(p => p.program === program);
  const d = dirs?.find(d => d.code === code);
  const canOpen = !!d && !d.isReadonly && (me?.globalRole === 'ADMIN' || d.myRole === 'CURATOR');
  const create = useMutation({ mutationFn: () => api(`/directions/${code}/periods`, { method: 'POST', body: { date, program } }), onSuccess: async () => { setOpened(false); await qc.invalidateQueries({ queryKey: ['dir', code] }); } });
  if (config.error) return <Alert color="red">{config.error.message}</Alert>;
  return <Stack>
    <Group align="flex-end"><Select label="Программа отчёта" aria-label="Программа отчёта" data={codes.map(value => ({ value, label: names[value] ?? (value || 'Без программы') }))} value={program} allowDeselect={false}
      onChange={v => { if (!dirty || window.confirm('Несохранённые изменения будут потеряны. Сменить программу?')) { setDirty(false); setSelected(v); } }} />
      {!own.length && canOpen && <Button onClick={() => setOpened(true)}>Открыть первый отчёт</Button>}
    </Group>
    {!!own.length ? <EntryTab key={program} code={code} periodKind="REPORT" program={program} onDirty={setDirty} /> : <Alert color="gray">В этой программе ещё нет отчётных периодов.</Alert>}
    <Modal opened={opened} onClose={() => setOpened(false)} title="Новый отчёт программы">
      <Stack><TextInput type="date" label="Дата отчёта" value={date} onChange={e => setDate(e.currentTarget.value)} />{create.error && <Alert color="red">{create.error.message}</Alert>}
        <Button disabled={!date || !program} loading={create.isPending} onClick={() => create.mutate()}>Открыть отчёт</Button></Stack>
    </Modal>
  </Stack>;
}
