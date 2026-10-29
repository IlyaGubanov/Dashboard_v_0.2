import { useState } from 'react';
import { Alert, Button, Card, Grid, Group, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { IconRefresh } from '@tabler/icons-react';
import type { OverviewDirection } from '@mvs/shared';
import { overviewQuery } from '../api';
import { MyTasksCard } from '../layout/MyTasks';
import { RiskBadge } from '../ui/RiskBadge';
import { int, money, pct, pp } from '../ui/format';
import { asOfLabel, DirectionCard } from './overview/DirectionCard';
import { AttentionList } from './overview/AttentionList';
import { MoneyChart } from './overview/MoneyChart';
import { RemarksList } from './overview/RemarksList';

const sum = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

/** Производственная сводка для руководства: все направления на последнюю отчётную точку. */
export function OverviewPage() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery(overviewQuery);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const dirs = data?.directions ?? [];

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Производственная сводка</Title>
          <Text c="dimmed" size="sm">
            Готовность против графика, отстающие объекты, ресурсы и деньги по всем направлениям
            {dataUpdatedAt ? ` · обновлено в ${new Date(dataUpdatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </Text>
        </div>
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} loading={isFetching} onClick={() => refetch()}>
          Обновить
        </Button>
      </Group>

      <MyTasksCard />
      {error && <Alert color="red">{(error as Error).message}</Alert>}
      {isLoading && <Skeleton h={420} radius="md" />}

      {!!dirs.length && (
        <>
          <Totals dirs={dirs} />

          <Group justify="space-between">
            <Text fw={600}>Направления</Text>
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setView(v as 'cards' | 'table')}
              data={[
                { value: 'cards', label: 'Карточки' },
                { value: 'table', label: 'Таблица' },
              ]}
            />
          </Group>
          {view === 'cards' ? (
            // колонки — по ширине области содержимого, а не окна: карточке нужно ~340 px
            <SimpleGrid type="container" cols={{ base: 1, '680px': 2, '1440px': Math.min(4, dirs.length) }}>
              {dirs.map((d) => (
                <DirectionCard key={d.code} d={d} />
              ))}
            </SimpleGrid>
          ) : (
            <DirectionsTable dirs={dirs} />
          )}

          <Grid gutter="md">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <AttentionList directions={dirs} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 5 }}>
              <Stack>
                <MoneyChart directions={dirs} />
                {dirs.map((d) => (d.kpi.remarks?.length ? <RemarksList key={d.code} d={d} /> : null))}
              </Stack>
            </Grid.Col>
          </Grid>
        </>
      )}

      {data && !dirs.length && <Alert color="gray">Вам пока не назначено ни одного направления. Обратитесь к администратору.</Alert>}
    </Stack>
  );
}

/** Итоговая строка по всем направлениям. */
function Totals({ dirs }: { dirs: OverviewDirection[] }) {
  const k = dirs.map((d) => d.kpi);
  const tiles = [
    { label: 'Объектов в работе', value: int(sum(k.map((x) => x.sites))) },
    { label: 'Отстают от графика', value: int(sum(k.map((x) => x.lagging))) },
    { label: 'Из них критично', value: int(sum(k.map((x) => x.critical))) },
    { label: 'Людей на объектах', value: int(sum(k.map((x) => x.people))) },
    { label: 'Техники', value: int(sum(k.map((x) => x.tech))) },
    { label: 'Стоимость работ', value: money(sum(k.map((x) => x.money?.portfolio))) },
  ];
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
      {tiles.map((t) => (
        <Card key={t.label} withBorder padding="md">
          <Text size="xs" c="dimmed">
            {t.label}
          </Text>
          <Text fz={{ base: 18, sm: 22 }} fw={700} style={{ whiteSpace: 'nowrap' }}>
            {t.value}
          </Text>
        </Card>
      ))}
    </SimpleGrid>
  );
}

/** То же, что карточки, — таблицей (для сравнения и для экранного диктора). */
function DirectionsTable({ dirs }: { dirs: OverviewDirection[] }) {
  return (
    <Card withBorder padding={0}>
      <Table.ScrollContainer minWidth={1000}>
        <Table striped highlightOnHover verticalSpacing="sm" styles={{ td: { whiteSpace: 'nowrap' }, th: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Направление</Table.Th>
              <Table.Th>Отчётная точка</Table.Th>
              <Table.Th ta="right">Факт</Table.Th>
              <Table.Th ta="right">План</Table.Th>
              <Table.Th ta="right">Отклонение</Table.Th>
              <Table.Th>Состояние</Table.Th>
              <Table.Th ta="right">Объектов</Table.Th>
              <Table.Th ta="right">Отстают / крит.</Table.Th>
              <Table.Th ta="right">Люди / техника</Table.Th>
              <Table.Th ta="right">Стоимость</Table.Th>
              <Table.Th ta="right">Оплачено</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dirs.map((d) => {
              const k = d.kpi;
              return (
                <Table.Tr key={d.code}>
                  <Table.Td>
                    <Link to="/d/$code" params={{ code: d.code }}>
                      {d.shortName}
                    </Link>
                  </Table.Td>
                  <Table.Td>
                    {asOfLabel(k)}
                    {!k.verified && k.asOf ? ' · не проверено' : ''}
                  </Table.Td>
                  <Table.Td ta="right">{pct(k.fact)}</Table.Td>
                  <Table.Td ta="right">{pct(k.plan)}</Table.Td>
                  <Table.Td ta="right">{k.plan == null ? '—' : pp(k.fact != null ? k.fact - k.plan : null)}</Table.Td>
                  <Table.Td>{k.plan == null ? 'без графика' : <RiskBadge risk={k.risk} size="xs" />}</Table.Td>
                  <Table.Td ta="right">{int(k.sites)}</Table.Td>
                  <Table.Td ta="right">{k.lagging == null ? '—' : `${int(k.lagging)} / ${int(k.critical)}`}</Table.Td>
                  <Table.Td ta="right">
                    {int(k.people)} / {int(k.tech)}
                  </Table.Td>
                  <Table.Td ta="right">{money(k.money?.portfolio)}</Table.Td>
                  <Table.Td ta="right">{money(k.money?.paid)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
