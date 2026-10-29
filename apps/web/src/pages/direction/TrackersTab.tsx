import { useMemo, useState } from 'react';
import { Alert, Box, Card, Group, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { TrackersView } from '@mvs/shared';
import { directionQueries } from '../../api';
import { TrackerValue, stageDone } from '../../ui/TrackerValue';
import { seq } from '../../ui/seq';
import { date, pct } from '../../ui/format';

type Tracker = TrackersView['trackers'][number];

/** Надстройки по всем объектам: закупки, испытания, МГЭ, документация — сводка, таблица, просрочки. */
export function TrackersTab({ code, onOpenSite }: { code: string; onOpenSite: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.trackers(code));
  const [active, setActive] = useState<string | null>(null);
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;
  const list = data.trackers.filter((t) => t.rows.length);
  if (!list.length) return <Alert color="gray">У направления нет надстроек.</Alert>;
  const t = list.find((x) => x.code === active) ?? list[0];

  return (
    <Stack>
      {list.length > 1 && (
        <SegmentedControl value={t.code} onChange={setActive} data={list.map((x) => ({ value: x.code, label: x.name }))} style={{ alignSelf: 'flex-start' }} />
      )}
      {t.layout === 'CARD' ? <CardTracker t={t} onOpenSite={onOpenSite} /> : <MatrixTracker t={t} onOpenSite={onOpenSite} />}
    </Stack>
  );
}

/** Строки × этапы: выбранный этап показывается таблицей «позиция × объект». */
function MatrixTracker({ t, onOpenSite }: { t: Tracker; onOpenSite: (id: number) => void }) {
  const [stageCode, setStageCode] = useState(t.stages[0]?.code);
  const stage = t.stages.find((s) => s.code === stageCode) ?? t.stages[0];
  const sites = useMemo(() => [...new Map(t.rows.map((r) => [r.siteId, r.siteName])).entries()], [t]);
  const cell = new Map(t.rows.map((r) => [`${r.item.code}|${r.siteId}`, r]));
  const today = new Date().toISOString().slice(0, 10);

  // сводка по этапам: средняя готовность по всем строкам всех объектов
  const summary = t.stages.map((s) => {
    const v = t.rows.map((r) => stageDone(s, r.values[s.code])).filter((x): x is number => x != null);
    return { s, done: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: t.rows.length };
  });
  // просрочено: плановая дата прошла, а этап не завершён
  const overdue = t.rows
    .filter((r) => r.planDate && r.planDate < today && (stageDone(stage, r.values[stage.code]) ?? 0) < 1)
    .sort((a, b) => (a.planDate! < b.planDate! ? -1 : 1));

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: Math.min(4, summary.length) }}>
        {summary.map(({ s, done, n }) => (
          <Card key={s.code} withBorder padding="md">
            <Text size="xs" c="dimmed">
              {s.name}
            </Text>
            <Text fz={22} fw={700}>
              {pct(done, 0)}
            </Text>
            <Text size="xs" c="dimmed">
              в среднем по {n} строкам
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <Card withBorder padding={0}>
        <Group p="md" justify="space-between">
          <Text fw={600}>{t.name} по объектам</Text>
          {t.stages.length > 1 && (
            <SegmentedControl size="xs" value={stage.code} onChange={setStageCode} data={t.stages.map((s) => ({ value: s.code, label: s.name }))} />
          )}
        </Group>
        <Box style={{ overflow: 'auto', maxHeight: '65vh' }}>
          <Table striped stickyHeader verticalSpacing={4} styles={{ td: { whiteSpace: 'nowrap', fontSize: 13 }, th: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Позиция</Table.Th>
                {sites.map(([id, name]) => (
                  <Table.Th key={id} style={{ cursor: 'pointer' }} onClick={() => onOpenSite(id)}>
                    {name}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {t.items.map((it) => (
                <Table.Tr key={it.code}>
                  <Table.Td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                    <Text size="sm">{it.name}</Text>
                    {it.category && (
                      <Text size="xs" c="dimmed">
                        {it.category}
                      </Text>
                    )}
                  </Table.Td>
                  {sites.map(([id]) => {
                    const r = cell.get(`${it.code}|${id}`);
                    const v = r?.values[stage.code];
                    const done = stageDone(stage, v);
                    const late = !!r?.planDate && r.planDate < today && (done ?? 0) < 1;
                    return (
                      <Table.Td key={id} style={stage.valueType === 'PERCENT' && done != null ? seq(done) : undefined}>
                        <Tooltip
                          disabled={!r?.planDate && !r?.dueDate}
                          label={`${r?.planDate ? `поставка ${date(r.planDate)}` : ''}${r?.dueDate ? ` · завершение ${date(r.dueDate)}` : ''}`}
                        >
                          <Group gap={4} wrap="nowrap">
                            {r ? <TrackerValue stage={stage} value={v} /> : <Text c="dimmed">·</Text>}
                            {late && <Box w={7} h={7} style={{ borderRadius: 4, background: 'var(--status-critical)' }} aria-label="просрочено" />}
                          </Group>
                        </Tooltip>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      </Card>

      {overdue.length > 0 && (
        <Card withBorder padding="lg">
          <Text fw={600}>
            Плановая дата прошла, этап «{stage.name}» не завершён: {overdue.length}
          </Text>
          <Table mt="sm" verticalSpacing={4} styles={{ td: { whiteSpace: 'nowrap' } }}>
            <Table.Tbody>
              {overdue.slice(0, 30).map((r) => (
                <Table.Tr key={`${r.item.code}|${r.siteId}`} style={{ cursor: 'pointer' }} onClick={() => onOpenSite(r.siteId)}>
                  <Table.Td>{r.siteName}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'normal' }}>{r.item.name}</Table.Td>
                  <Table.Td>срок {date(r.planDate)}</Table.Td>
                  <Table.Td>
                    <TrackerValue stage={stage} value={r.values[stage.code]} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}

/** Одна строка на объект (МГЭ, документация): объекты × этапы. */
function CardTracker({ t, onOpenSite }: { t: Tracker; onOpenSite: (id: number) => void }) {
  return (
    <Card withBorder padding={0}>
      <Table.ScrollContainer minWidth={900}>
        <Table striped highlightOnHover verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' }, th: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Объект</Table.Th>
              {t.stages.map((s) => (
                <Table.Th key={s.code}>{s.name}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {t.rows.map((r) => (
              <Table.Tr key={r.siteId} style={{ cursor: 'pointer' }} onClick={() => onOpenSite(r.siteId)}>
                <Table.Td style={{ whiteSpace: 'normal', minWidth: 240 }}>{r.siteName}</Table.Td>
                {t.stages.map((s) => (
                  <Table.Td key={s.code} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <TrackerValue stage={s} value={r.values[s.code]} />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
