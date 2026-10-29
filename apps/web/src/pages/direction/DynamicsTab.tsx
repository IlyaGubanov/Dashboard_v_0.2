import { useCallback, useState } from 'react';
import { Alert, Card, Group, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { DynamicsPoint } from '@mvs/shared';
import { directionQueries } from '../../api';
import { EChart, type ChartColors } from '../../ui/EChart';
import { factPlanChart, seriesChart } from '../../ui/charts';
import { date, int, money, pct, pp } from '../../ui/format';

/** Динамика направления: готовность против плана, ресурсы, деньги — по отчётным точкам до даты среза. */
export function DynamicsTab({ code, date: asOf }: { code: string; date?: string }) {
  const { data, error } = useQuery(directionQueries.dynamics(code, asOf));
  const [view, setView] = useState<'charts' | 'table'>('charts');
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;
  const withFact = data.filter((p) => p.fact != null);
  if (!data.length) return <Alert color="gray">Отчётных данных пока нет.</Alert>;

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {data.length} отчётных точек · {date(data[0].date)} — {date(data.at(-1)!.date)}
        </Text>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => setView(v as 'charts' | 'table')}
          data={[
            { value: 'charts', label: 'Графики' },
            { value: 'table', label: 'Таблица' },
          ]}
        />
      </Group>
      {view === 'charts' ? <Charts pts={data} factPts={withFact} /> : <PointsTable pts={data} />}
    </Stack>
  );
}

function Charts({ pts, factPts }: { pts: DynamicsPoint[]; factPts: DynamicsPoint[] }) {
  const has = (k: keyof DynamicsPoint) => pts.some((p) => p[k] != null);
  const fp = useCallback((c: ChartColors) => factPlanChart(factPts, c), [factPts]);
  const people = useCallback((c: ChartColors) => seriesChart(pts, c, [{ name: 'Людей', key: 'people', color: c.series[0] }], 'count'), [pts]);
  const tech = useCallback((c: ChartColors) => seriesChart(pts, c, [{ name: 'Техники', key: 'tech', color: c.series[1] }], 'count'), [pts]);
  const moneyLines = (c: ChartColors) =>
    [
      has('closed') && { name: 'Закрыто по КС-2', key: 'closed' as const, color: c.series[1] },
      has('paid') && { name: 'Оплачено', key: 'paid' as const, color: c.series[2] },
    ].filter(Boolean) as { name: string; key: keyof DynamicsPoint; color: string }[];
  const mon = useCallback((c: ChartColors) => seriesChart(pts, c, moneyLines(c), 'money'), [pts]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = factPts.at(-1), first = factPts[0];
  return (
    <Stack>
      {factPts.length > 0 && (
        <Card withBorder padding="lg">
          <Group justify="space-between" mb={4}>
            <Text fw={600}>{factPts.some((p) => p.plan != null) ? 'Готовность: факт против плана' : 'Готовность'}</Text>
            {last && first && last !== first && (
              <Text size="sm" c="dimmed">
                за период: {pct(first.fact)} → {pct(last.fact)} ({pp((last.fact ?? 0) - (first.fact ?? 0))})
              </Text>
            )}
          </Group>
          {factPts.length > 1 ? (
            <EChart option={fp} height={300} ariaLabel="График готовности: факт против плана по отчётным точкам" />
          ) : (
            <Text size="sm" c="dimmed">
              Готовность есть только на одну дату ({date(factPts[0].date)}) — график появится, когда накопится история.
            </Text>
          )}
        </Card>
      )}
      {(has('people') || has('tech')) && (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {has('people') && (
            <Card withBorder padding="lg">
              <Text fw={600}>Людей на объектах</Text>
              <EChart option={people} height={220} ariaLabel="График численности людей на объектах" />
            </Card>
          )}
          {has('tech') && (
            <Card withBorder padding="lg">
              <Text fw={600}>Техники на объектах</Text>
              <EChart option={tech} height={220} ariaLabel="График количества техники на объектах" />
            </Card>
          )}
        </SimpleGrid>
      )}
      {(has('closed') || has('paid')) && (
        <Card withBorder padding="lg">
          <Text fw={600}>Освоение нарастающим итогом</Text>
          <EChart option={mon} height={260} ariaLabel="График освоения: закрыто по КС-2 и оплачено" />
        </Card>
      )}
    </Stack>
  );
}

function PointsTable({ pts }: { pts: DynamicsPoint[] }) {
  const has = (k: keyof DynamicsPoint) => pts.some((p) => p[k] != null);
  return (
    <Card withBorder padding={0}>
      <Table.ScrollContainer minWidth={700}>
        <Table striped verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Дата</Table.Th>
              <Table.Th ta="right">Факт</Table.Th>
              {has('plan') && <Table.Th ta="right">План</Table.Th>}
              {has('plan') && <Table.Th ta="right">Откл.</Table.Th>}
              {has('people') && <Table.Th ta="right">Людей</Table.Th>}
              {has('tech') && <Table.Th ta="right">Техники</Table.Th>}
              {has('closed') && <Table.Th ta="right">КС-2</Table.Th>}
              {has('paid') && <Table.Th ta="right">Оплачено</Table.Th>}
              <Table.Th>Проверено</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...pts].reverse().map((p) => (
              <Table.Tr key={p.date}>
                <Table.Td>{date(p.date)}</Table.Td>
                <Table.Td ta="right">{pct(p.fact)}</Table.Td>
                {has('plan') && <Table.Td ta="right">{pct(p.plan)}</Table.Td>}
                {has('plan') && <Table.Td ta="right">{p.fact != null && p.plan != null ? pp(p.fact - p.plan) : '—'}</Table.Td>}
                {has('people') && <Table.Td ta="right">{int(p.people)}</Table.Td>}
                {has('tech') && <Table.Td ta="right">{int(p.tech)}</Table.Td>}
                {has('closed') && <Table.Td ta="right">{money(p.closed)}</Table.Td>}
                {has('paid') && <Table.Td ta="right">{money(p.paid)}</Table.Td>}
                <Table.Td>{p.verified ? 'да' : 'нет'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
