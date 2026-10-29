import { Box, Group, Text } from '@mantine/core';
import type { SiteCardTracker } from '@mvs/shared';
import { date, pct } from './format';

export type TrackerStage = SiteCardTracker['stages'][number];
export type TrackerRawValue = string | number | boolean | null | undefined;

/** Значение этапа надстройки по его типу: процент, да/нет, дата, статус (точка цвета + подпись), текст. */
export function TrackerValue({ stage, value }: { stage: TrackerStage; value: TrackerRawValue }) {
  if (value == null || value === '') return <Text c="dimmed">—</Text>;
  switch (stage.valueType) {
    case 'PERCENT':
      return <>{pct(Number(value) / 100, 0)}</>;
    case 'BOOL':
      return <>{value ? 'да' : 'нет'}</>;
    case 'DATE':
      return <>{date(String(value))}</>;
    case 'STATUS': {
      const o = stage.options?.find((x) => x.value === value);
      return (
        <Group gap={6} wrap="nowrap">
          <Box w={8} h={8} style={{ borderRadius: 4, flexShrink: 0, background: `var(--mantine-color-${o?.color ?? 'gray'}-6)` }} aria-hidden />
          <Text size="sm">{o?.label ?? String(value)}</Text>
        </Group>
      );
    }
    default:
      return <>{String(value)}</>;
  }
}

/** Доля выполнения этапа 0…1 (для сводок): процент, «да», итоговый статус, «+». */
export function stageDone(stage: TrackerStage, value: TrackerRawValue): number | null {
  if (value == null || value === '') return null;
  switch (stage.valueType) {
    case 'PERCENT':
      return Math.max(0, Math.min(1, Number(value) / 100));
    case 'BOOL':
      return value ? 1 : 0;
    case 'STATUS':
      return stage.options?.find((o) => o.value === value)?.done ? 1 : 0;
    case 'TEXT':
      return String(value).trim() === '+' ? 1 : 0;
    default:
      return null;
  }
}
