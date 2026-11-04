import { Accordion, Alert, Badge, Box, Button, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconCircleDashed, IconEqualNot, IconUser } from '@tabler/icons-react';
import { MACHINERY_STATUS, OWNERSHIP, TECHNICAL_STATE, type MachineryRow, type MachineryStatus, type MachineryView } from '@mvs/shared';
import { date, int } from '../../ui/format';

const ORDER: MachineryStatus[] = ['diff', 'kinds', 'onlyReport', 'onlyFleet', 'match', 'none'];
export const MACHINERY_ISSUES: MachineryStatus[] = ['diff', 'kinds', 'onlyReport', 'onlyFleet'];

/** Состояние — всегда иконка + подпись, цвет не несёт смысл в одиночку. */
const VIEW: Record<MachineryStatus, { color: string; Icon: typeof IconCircleCheck }> = {
  match: { color: 'var(--status-good)', Icon: IconCircleCheck },
  diff: { color: 'var(--status-critical)', Icon: IconEqualNot },
  kinds: { color: 'var(--status-warning)', Icon: IconAlertTriangle },
  onlyReport: { color: 'var(--status-warning)', Icon: IconUser },
  onlyFleet: { color: 'var(--status-warning)', Icon: IconAlertTriangle },
  none: { color: 'var(--status-none)', Icon: IconCircleDashed },
};

export function MachineryStatusBadge({ status }: { status: MachineryStatus }) {
  const v = VIEW[status];
  return (
    <Group gap={4} wrap="nowrap">
      <v.Icon size={15} color={v.color} stroke={2.2} aria-hidden style={{ flexShrink: 0 }} />
      <Text size="xs" fw={500} style={{ whiteSpace: 'nowrap' }}>
        {MACHINERY_STATUS[status]}
      </Text>
    </Group>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : null);

/** Кто и когда внёс данные с одной стороны сверки. */
function Source({ title, total, by, at, note }: { title: string; total: number | null | undefined; by: string | null; at: string | null; note?: string }) {
  return (
    <Box className="direction-metric">
      <Text size="xs" c="dimmed">
        {title}
      </Text>
      <Text fw={700} size="lg" lh={1.3}>
        {total == null ? 'не внесено' : `${int(total)} ед.`}
      </Text>
      <Text size="xs" style={{ overflowWrap: 'anywhere' }}>
        {by ?? (at ? 'автор не указан' : '—')}
      </Text>
      {(at || note) && (
        <Text size="xs" c="dimmed">
          {[at ? `внесено ${when(at)}` : null, note].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Box>
  );
}

function ExplainStatus({ row }: { row: MachineryRow }) {
  const f = row.fleet?.total ?? 0;
  const r = row.reported.total ?? 0;
  const text: Partial<Record<MachineryStatus, string>> = {
    diff: `Ответственный указал ${int(r)} ед., в РЭБ распределено ${int(f)}: разница ${int(Math.abs(r - f))} ед.`,
    kinds: 'Количество совпадает, но виды техники различаются.',
    onlyReport: 'Ответственный указал технику, а в РЭБ на этот объект ничего не распределено.',
    onlyFleet: 'В РЭБ техника на объект распределена, а ответственный её не указал.',
  };
  const message = row.status ? text[row.status] : null;
  return message ? <Text size="sm">{message}</Text> : null;
}

/** Строка объекта: итог с двух сторон; раскрывается в сравнение по видам и список машин. */
function MachineryItem({ row, showDirection, onOpenSite }: { row: MachineryRow; showDirection?: boolean; onOpenSite: (row: MachineryRow) => void }) {
  const showKinds = row.kinds.length > 0;
  const fleetOnly = !showKinds && !!row.fleet?.byKind.length;
  return (
    <Accordion.Item value={`${row.direction.code}:${row.siteId}`}>
      <Accordion.Control>
        {/* на узком экране состояние уходит под название, а не разрывает его посреди слова */}
        <Group justify="space-between" gap="xs">
          <Box style={{ flex: '1 1 170px', minWidth: 0 }}>
            <Text size="sm" fw={500} style={{ overflowWrap: 'break-word' }}>
              {row.siteName}
            </Text>
            <Text size="xs" c="dimmed">
              {showDirection ? `${row.direction.shortName} · ` : ''}отв.: {row.reported.total == null ? '—' : int(row.reported.total)}
              {row.fleet ? ` · РЭБ: ${int(row.fleet.total)}` : ''}
            </Text>
          </Box>
          {row.status && <MachineryStatusBadge status={row.status} />}
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="sm">
          <ExplainStatus row={row} />
          <SimpleGrid cols={row.fleet ? 2 : 1} spacing="xs">
            <Source title="Ответственный за объект" total={row.reported.total} by={row.reported.by} at={row.reported.at} note={row.reported.from ? `на ${date(row.reported.from)}` : undefined} />
            {row.fleet && <Source title="РЭБ" total={row.fleet.total} by={row.fleet.by.length ? row.fleet.by.join(', ') : null} at={row.fleet.at} />}
          </SimpleGrid>
          {showKinds && (
            <Table.ScrollContainer minWidth={280}>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Вид техники</Table.Th>
                    <Table.Th ta="right">Отв.</Table.Th>
                    {row.fleet && <Table.Th ta="right">РЭБ</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {row.kinds.map((k) => (
                    <Table.Tr key={k.kind} fw={row.fleet && k.reported !== k.fleet ? 700 : undefined}>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          {row.fleet && k.reported !== k.fleet && <IconEqualNot size={14} color="var(--status-critical)" aria-label="Расходится" style={{ flexShrink: 0 }} />}
                          {k.kind}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">{k.reported ?? '—'}</Table.Td>
                      {row.fleet && <Table.Td ta="right">{k.fleet}</Table.Td>}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {!showKinds && row.reported.total != null && row.reported.total > 0 && (
            <Text size="xs" c="dimmed">
              Ответственный указал только общее число, без видов.
            </Text>
          )}
          {fleetOnly && (
            <Text size="sm">
              По данным РЭБ: {row.fleet!.byKind.map((l) => `${l.kind} — ${l.qty}`).join(', ')}
            </Text>
          )}
          {row.fleet?.vehicles?.length ? (
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                Машины РЭБ на объекте
              </Text>
              <Stack gap={4}>
                {row.fleet.vehicles.map((v) => (
                  <Group key={v.id} justify="space-between" wrap="nowrap" gap="xs">
                    <Box style={{ minWidth: 0 }}>
                      <Text size="xs" style={{ overflowWrap: 'anywhere' }}>
                        {v.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[v.plate ?? v.inventoryNumber, OWNERSHIP[v.ownership as keyof typeof OWNERSHIP]].filter(Boolean).join(' · ')}
                      </Text>
                    </Box>
                    <Text size="xs" style={{ flexShrink: 0 }}>
                      {TECHNICAL_STATE[v.technicalState as keyof typeof TECHNICAL_STATE] ?? v.technicalState}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Box>
          ) : null}
          <Group>
            <Button size="compact-sm" variant="subtle" onClick={() => onOpenSite(row)}>
              Карточка объекта →
            </Button>
          </Group>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

/** Фильтр по состоянию сверки: сколько объектов в каждом. */
export function MachineryFilter({ summary, value, onChange }: { summary: MachineryView['summary']; value: MachineryStatus | 'issues' | 'all'; onChange: (v: MachineryStatus | 'issues' | 'all') => void }) {
  const issues = MACHINERY_ISSUES.reduce((a, s) => a + summary[s], 0);
  const button = (key: MachineryStatus | 'issues' | 'all', label: string, n?: number) => (
    <Button key={key} size="compact-sm" variant={value === key ? 'filled' : 'default'} aria-pressed={value === key} onClick={() => onChange(key)}>
      {label}
      {n != null ? ` · ${int(n)}` : ''}
    </Button>
  );
  return (
    <Group gap={6}>
      {button('issues', 'Все расхождения', issues)}
      {ORDER.filter((s) => s !== 'none' && summary[s] > 0).map((s) => button(s, MACHINERY_STATUS[s], summary[s]))}
      {button('all', 'Все объекты')}
    </Group>
  );
}

export function machineryMatch(row: MachineryRow, filter: MachineryStatus | 'issues' | 'all') {
  if (filter === 'all') return true;
  if (!row.status) return false;
  return filter === 'issues' ? MACHINERY_ISSUES.includes(row.status) : row.status === filter;
}

/** Список объектов сверки: сначала то, что требует проверки. */
export function MachineryList({ rows, showDirection, onOpenSite }: { rows: MachineryRow[]; showDirection?: boolean; onOpenSite: (row: MachineryRow) => void }) {
  if (!rows.length) return <Text c="dimmed">Объектов в этой выборке нет.</Text>;
  const rank = (r: MachineryRow) => ORDER.indexOf(r.status ?? 'none');
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || Math.abs((b.reported.total ?? 0) - (b.fleet?.total ?? 0)) - Math.abs((a.reported.total ?? 0) - (a.fleet?.total ?? 0)) || (b.reported.total ?? 0) - (a.reported.total ?? 0));
  return (
    <Accordion variant="separated" chevronPosition="right">
      {sorted.map((r) => (
        <MachineryItem key={`${r.direction.code}:${r.siteId}`} row={r} showDirection={showDirection} onOpenSite={onOpenSite} />
      ))}
    </Accordion>
  );
}

/** Предупреждение над списком: сколько техники нельзя сверить по объектам. */
export function MachineryWithoutSite({ n }: { n: number }) {
  return n > 0 ? (
    <Alert color="gray" p="xs">
      <Group gap="xs">
        <Badge color="gray" variant="light">
          {int(n)} ед.
        </Badge>
        <Text size="sm">распределено на направление без указания объекта: в сверку по объектам не входит.</Text>
      </Group>
    </Alert>
  ) : null;
}
