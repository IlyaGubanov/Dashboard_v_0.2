import { useState } from 'react';
import { Alert, Card, Group, Select, SimpleGrid, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { IconSearch } from '@tabler/icons-react';
import type { MachineryStatus } from '@mvs/shared';
import { int } from '../../ui/format';
import { MachineryFilter, MachineryList, MachineryWithoutSite, MACHINERY_ISSUES, machineryMatch } from '../direction/MachineryCompare';
import { fleetQueries } from './api';

/** Сверка техники по всем направлениям: кто что внёс и где данные ответственного и РЭБ не совпадают. */
export function FleetReconciliation() {
  const { data, error } = useQuery(fleetQueries.reconciliation);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<MachineryStatus | 'issues' | 'all'>('issues');
  const [direction, setDirection] = useState<string | null>(null);
  const [q, setQ] = useState('');
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={300} />;
  const dirs = [...new Map(data.rows.map((r) => [r.direction.code, r.direction.shortName])).entries()].map(([value, label]) => ({ value, label }));
  const scope = data.rows.filter((r) => !direction || r.direction.code === direction);
  const term = q.trim().toLocaleLowerCase('ru');
  const rows = scope.filter((r) => machineryMatch(r, filter) && (!term || r.siteName.toLocaleLowerCase('ru').includes(term)));
  const summary = { ...data.summary };
  if (direction) for (const k of Object.keys(summary) as MachineryStatus[]) summary[k] = scope.filter((r) => r.status === k).length;
  const issues = MACHINERY_ISSUES.reduce((a, s) => a + summary[s], 0);
  const reported = scope.reduce((a, r) => a + (r.reported.total ?? 0), 0);
  const fleet = scope.reduce((a, r) => a + (r.fleet?.total ?? 0), 0);
  const tiles = [
    { label: 'Объектов с расхождениями', value: int(issues) },
    { label: 'Совпадают', value: int(summary.match) },
    { label: 'Техники по данным ответственных', value: `${int(reported)} ед.` },
    { label: 'Техники на объектах по РЭБ', value: `${int(fleet)} ед.` },
  ];
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs">
        {tiles.map((t) => (
          <Card key={t.label} withBorder padding="sm">
            <Text fw={700} size="xl" lh={1.2}>
              {t.value}
            </Text>
            <Text size="xs" c="dimmed">
              {t.label}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Select label="Направление" placeholder="Все направления" clearable data={dirs} value={direction} onChange={setDirection} />
        <TextInput label="Объект" placeholder="Название или адрес" leftSection={<IconSearch size={15} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      </SimpleGrid>
      <Group>
        <MachineryFilter summary={summary} value={filter} onChange={setFilter} />
      </Group>
      <MachineryWithoutSite n={data.fleetWithoutSite} />
      <MachineryList rows={rows} showDirection onOpenSite={(r) => navigate({ to: '/d/$code', params: { code: r.direction.code }, search: { site: r.siteId } as never })} />
    </Stack>
  );
}
