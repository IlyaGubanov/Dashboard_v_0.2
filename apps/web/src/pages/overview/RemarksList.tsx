import { Badge, Card, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { OverviewDirection } from '@mvs/shared';
import { date } from '../../ui/format';

/** Замечания из отчётов (Благоустройство): где их больше всего и остались ли невыполненные объёмы. */
export function RemarksList({ d }: { d: OverviewDirection }) {
  const navigate = useNavigate();
  const rows = d.kpi.remarks ?? [];
  if (!rows.length) return null;
  return (
    <Card withBorder padding="lg">
      <Text fw={600}>Замечания: {d.shortName.toLowerCase()}</Text>
      <Text size="xs" c="dimmed" mb="sm">
        По отчёту {date(d.kpi.asOf)}, объекты с наибольшим числом замечаний
      </Text>
      <Stack gap={2}>
        {rows.map((r) => (
          <UnstyledButton
            key={r.siteId}
            className="row-link"
            px={6}
            py={6}
            onClick={() => navigate({ to: '/d/$code', params: { code: d.code }, search: { site: r.siteId } })}
          >
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {r.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {r.status ?? 'статус не указан'}
                  {r.open > 0 ? ` · остаток по ${r.open} поз.` : ''}
                </Text>
              </div>
              <Badge variant="light" color="gray" size="lg" style={{ flexShrink: 0 }}>
                {r.n}
              </Badge>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </Card>
  );
}
