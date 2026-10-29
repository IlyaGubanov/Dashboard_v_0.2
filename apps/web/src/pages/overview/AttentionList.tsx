import { Badge, Box, Card, Group, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { OverviewDirection } from '@mvs/shared';
import { RiskBadge } from '../../ui/RiskBadge';
import { pct, pp } from '../../ui/format';

/** «Наибольшее отставание от графика» по всем направлениям сразу, с фильтром по направлению. */
export function AttentionList({ directions }: { directions: OverviewDirection[] }) {
  const navigate = useNavigate();
  const withPlan = directions.filter((d) => d.kpi.plan != null);
  const [filter, setFilter] = useState('all');
  const rows = withPlan
    .filter((d) => filter === 'all' || d.code === filter)
    .flatMap((d) => d.kpi.attention.map((a) => ({ ...a, dir: d })))
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);
  const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.d)));

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <div>
          <Text fw={600}>Наибольшее отставание от графика</Text>
          <Text size="xs" c="dimmed">
            Факт минус план на дату отчёта, по объектам
          </Text>
        </div>
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[{ value: 'all', label: 'Все' }, ...withPlan.map((d) => ({ value: d.code, label: d.shortName }))]}
        />
      </Group>
      <Stack gap={2}>
        {rows.map((r) => (
          <UnstyledButton
            key={`${r.dir.code}-${r.siteId}`}
            className="row-link"
            px={6}
            py={6}
            onClick={() => navigate({ to: '/d/$code', params: { code: r.dir.code }, search: { site: r.siteId } })}
            aria-label={`${r.name}: отставание ${pp(r.d)}`}
          >
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Box style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={500} truncate>
                  {r.name}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Badge size="xs" variant="light" color={r.dir.color ?? 'gray'}>
                    {r.dir.shortName}
                  </Badge>
                  <Text size="xs" c="dimmed" truncate>
                    {r.section ? `${r.section} · ` : ''}факт {pct(r.fact, 0)} · план {pct(r.plan, 0)}
                  </Text>
                </Group>
              </Box>
              <Box w={120} visibleFrom="xs">
                <Box style={{ height: 8, borderRadius: 4, background: 'var(--track)', display: 'flex', justifyContent: 'flex-end' }}>
                  <Box
                    style={{
                      width: `${(Math.abs(r.d) / maxAbs) * 100}%`,
                      height: '100%',
                      borderRadius: 4,
                      background: r.crit ? 'var(--status-critical)' : 'var(--status-warning)',
                    }}
                  />
                </Box>
              </Box>
              <Box w={96} style={{ textAlign: 'right' }}>
                <Text size="sm" fw={600}>
                  {pp(r.d)}
                </Text>
                <RiskBadge risk={r.crit ? 'crit' : 'warn'} size="xs" />
              </Box>
            </Group>
          </UnstyledButton>
        ))}
        {!rows.length && (
          <Text size="sm" c="dimmed">
            Отстающих объектов нет.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
