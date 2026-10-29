import { Box, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { OverviewDirection } from '@mvs/shared';
import { money, pct } from '../../ui/format';

const SERIES = [
  { key: 'portfolio', label: 'Стоимость (договор / лимит)', color: 'var(--series-1)' },
  { key: 'closed', label: 'Закрыто по КС-2', color: 'var(--series-2)' },
  { key: 'paid', label: 'Оплачено', color: 'var(--series-3)' },
] as const;

/**
 * Деньги по направлениям: три меры на одной шкале рублей (одна ось), значения подписаны у каждой полосы.
 * Мера, которой у направления нет (Сети не ведут оплату, Школы — КС-2), не рисуется.
 */
export function MoneyChart({ directions }: { directions: OverviewDirection[] }) {
  const rows = directions.filter((d) => d.kpi.money);
  const max = Math.max(1, ...rows.flatMap((d) => SERIES.map((s) => d.kpi.money![s.key] ?? 0)));

  return (
    <Card withBorder padding="lg">
      <Text fw={600}>Деньги по направлениям</Text>
      <Group gap="md" mt={6} mb="md">
        {SERIES.map((s) => (
          <Group key={s.key} gap={6} wrap="nowrap">
            <Box w={12} h={12} style={{ borderRadius: 3, background: s.color }} aria-hidden />
            <Text size="xs">{s.label}</Text>
          </Group>
        ))}
      </Group>
      <Stack gap="md">
        {rows.map((d) => {
          const m = d.kpi.money!;
          return (
            <div key={d.code}>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={600}>
                  {d.shortName}
                </Text>
                <Text size="xs" c="dimmed">
                  {m.portfolioLabel}
                </Text>
              </Group>
              <Stack gap={2}>
                {SERIES.map((s) => {
                  const v = m[s.key];
                  if (v == null) return null;
                  const share = s.key !== 'portfolio' && m.portfolio ? ` · ${pct(v / m.portfolio)} от стоимости` : '';
                  return (
                    <Tooltip key={s.key} label={`${d.shortName} — ${s.label.toLowerCase()}: ${money(v)}${share}`} withArrow>
                      <Group gap={8} wrap="nowrap" py={2} style={{ cursor: 'default' }}>
                        <Box style={{ flex: 1 }}>
                          <Box
                            style={{
                              width: `${Math.max(0.5, (v / max) * 100)}%`,
                              height: 8,
                              borderRadius: 4,
                              background: s.color,
                            }}
                          />
                        </Box>
                        <Text size="xs" w={110} ta="right" style={{ whiteSpace: 'nowrap' }}>
                          {money(v)}
                        </Text>
                      </Group>
                    </Tooltip>
                  );
                })}
              </Stack>
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}
