import { useState } from 'react';
import { Button, Group, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Tooltip } from '@mantine/core';
import type { ReportProgramSummary } from '@mvs/shared';
import { date, int } from '../../ui/format';
import { ReportAggregateView } from './ReportAggregate';
const sourceLabel: Record<string, string> = { IMPORT: 'Импорт', MANUAL: 'Ручной ввод', API: 'API', MIGRATION: 'Миграция' };
const yes = (v: boolean | null) => v == null ? 'Нет данных' : v ? 'Да' : 'Нет';
export function ReportPrograms({ programs, onOpenSite }: { programs: ReportProgramSummary[]; onOpenSite: (id: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null), [mode, setMode] = useState('all'), [opened, setOpened] = useState(false);
  const p = programs.find(p => p.code === selected) ?? programs[0];
  if (!p) return null;
  const rows = p.rows.filter(s => mode === 'volume' ? s.volumeDone : mode === 'status' ? s.statusDone : mode === 'statusOnly' ? s.statusDone && s.volumeDone === false : mode === 'volumeOnly' ? s.volumeDone && s.statusDone === false : mode === 'remarks' ? s.remarksCount != null : true);
  const show = (m: string) => { setMode(m); setOpened(true); };
  return <Paper withBorder p="md">
    <Group justify="space-between" mb="sm"><Select label="Отчётный срез программы" data={programs.map(p => ({ value: p.code, label: p.name || 'Без программы' }))} value={p.code} allowDeselect={false} onChange={setSelected} />
      <Text size="sm">На {date(p.asOf)}{p.sheet ? ` · ${p.sheet}` : ''}</Text></Group>
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Tooltip label={p.volumeMethod} multiline w={350} withArrow><Button variant="default" h="auto" py="sm" onClick={() => show('volume')}><Stack gap={2}><Text size="sm">Выполнено по объёмам</Text><Text fw={700} size="lg">{p.volumeDone} из {p.volumeTotal}</Text></Stack></Button></Tooltip>
      <Tooltip label={p.statusMethod} multiline w={350} withArrow><Button variant="default" h="auto" py="sm" styles={{ label: { whiteSpace: 'normal' } }} onClick={() => show('status')}><Stack gap={2}><Text size="sm">Завершено по отчётному статусу</Text><Text fw={700} size="lg">{int(p.statusDone)} из {p.statusTotal}</Text></Stack></Button></Tooltip>
    </SimpleGrid>
    <Group mt="sm" gap="xs"><Button size="xs" variant="subtle" onClick={() => show('statusOnly')}>По статусу, без объёмов · {p.rows.filter(s => s.statusDone && s.volumeDone === false).length}</Button>
      <Button size="xs" variant="subtle" onClick={() => show('volumeOnly')}>По объёмам, без статуса · {p.rows.filter(s => s.volumeDone && s.statusDone === false).length}</Button>
      {p.rows.some(s => s.remarksCount !== undefined) && <Button size="xs" variant="subtle" onClick={() => show('remarks')}>Замечания по отчёту</Button>}
      <Button size="xs" variant="subtle" onClick={() => show('all')}>Все объекты отчёта</Button></Group>
    {p.source && <Text size="xs" c="dimmed" mt={6}>Источник: {p.source}</Text>}
    {p.aggregate && <ReportAggregateView value={p.aggregate} />}
    <Modal opened={opened} onClose={() => setOpened(false)} title={`${p.name} · ${date(p.asOf)}`} size="xl" zIndex={400}>
      <Stack gap="sm"><Text size="sm">{p.volumeMethod}</Text><Text size="sm">{p.statusMethod}</Text>
        <Text size="xs" c="dimmed">Число замечаний в отчёте и зарегистрированные нарушения — отдельные наборы данных, они не суммируются.</Text>
        <ScrollArea.Autosize mah="60vh"><Table.ScrollContainer minWidth={700}><Table verticalSpacing="xs"><Table.Thead><Table.Tr>
          <Table.Th>Объект</Table.Th><Table.Th>По объёмам</Table.Th><Table.Th>По статусу</Table.Th><Table.Th>Отчётный статус</Table.Th><Table.Th>Замечания по отчёту</Table.Th><Table.Th>Источник</Table.Th>
        </Table.Tr></Table.Thead><Table.Tbody>{rows.map(s => <Table.Tr key={s.id}>
          <Table.Td><Button variant="subtle" size="compact-sm" styles={{ label: { whiteSpace: 'normal', textAlign: 'left' } }} onClick={() => { setOpened(false); onOpenSite(s.id); }}>{s.name}</Button></Table.Td>
          <Table.Td>{yes(s.volumeDone)}</Table.Td><Table.Td>{yes(s.statusDone)}</Table.Td><Table.Td>{s.statusText ?? 'Нет данных'}</Table.Td>
          <Table.Td ta="right">{s.remarksCount == null ? 'Нет данных' : s.remarksCount}</Table.Td><Table.Td>{s.source ? sourceLabel[s.source] ?? s.source : 'Не указан'}</Table.Td>
        </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></ScrollArea.Autosize>
        {!rows.length && <Text c="dimmed">Объектов в этой выборке нет.</Text>}
      </Stack>
    </Modal>
  </Paper>;
}
