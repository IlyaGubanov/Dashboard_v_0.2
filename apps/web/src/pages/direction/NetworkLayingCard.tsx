import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { NetworkLayingKpi } from '@mvs/shared';
import { FactPlanBar } from '../../ui/FactPlanBar';
import { int, pct } from '../../ui/format';

const LABELS = { open: 'Открытая прокладка', closed: 'Закрытая прокладка' } as const;
const meters = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const qty = (value: number | null) => (value == null ? '—' : meters.format(value));

/** Используем существующие компоненты и палитру проекта (Mantine), как на остальных карточках обзора. */
export function NetworkLayingCard({ rows }: { rows: NetworkLayingKpi[] | undefined }) {
  return (
    <Card component="section" aria-label="Сети по способу прокладки" withBorder padding="lg">
      <Text component="h3" size="md" fw={600} mb="sm">Сети по способу прокладки</Text>
      {!rows?.length ? (
        <Text size="sm" c="dimmed">Нет данных на дату среза</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl" verticalSpacing="lg">
          {rows.map((row) => (
            <Stack key={row.code} gap={4}>
              <Group justify="space-between" gap="xs">
                <Text component="h4" size="sm" fw={600}>{LABELS[row.code]}</Text>
                <Text size="xs" c="dimmed">Объектов: {int(row.sites)}</Text>
              </Group>
              <SimpleGrid cols={2} spacing="sm">
                <div>
                  <Text size="xs" c="dimmed">Выполнено, п.м</Text>
                  <Text size="xl" fw={600}>{qty(row.factQty)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Проект, п.м</Text>
                  <Text size="xl" fw={600}>{qty(row.planQty)}</Text>
                </div>
              </SimpleGrid>
              <Group justify="space-between" gap="xs">
                <Text size="xs" c="dimmed">Готовность</Text>
                <Text size="sm" fw={600}>{pct(row.fact)}</Text>
              </Group>
              <FactPlanBar fact={row.fact} plan={null} color="var(--series-1)" height={6} label={LABELS[row.code]} />
            </Stack>
          ))}
        </SimpleGrid>
      )}
    </Card>
  );
}
