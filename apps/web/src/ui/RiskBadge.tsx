import { Group, Text } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconCircleDashed, IconCircleX } from '@tabler/icons-react';
import type { RiskLevel, SiteRisk } from '@mvs/shared';

/** Состояние — всегда иконка + подпись, цвет не несёт смысл в одиночку. */
const VIEW: Record<SiteRisk, { label: string; color: string; Icon: typeof IconCircleCheck }> = {
  ok: { label: 'В графике', color: 'var(--status-good)', Icon: IconCircleCheck },
  done: { label: 'Выполнено', color: 'var(--status-good)', Icon: IconCircleCheck },
  warn: { label: 'Отставание', color: 'var(--status-warning)', Icon: IconAlertTriangle },
  crit: { label: 'Критично', color: 'var(--status-critical)', Icon: IconCircleX },
  wait: { label: 'Не начато', color: 'var(--status-none)', Icon: IconCircleDashed },
  na: { label: 'Без графика', color: 'var(--status-none)', Icon: IconCircleDashed },
};

export function RiskBadge({ risk, size = 'sm', label }: { risk: RiskLevel | SiteRisk; size?: 'xs' | 'sm'; label?: string }) {
  const v = VIEW[risk];
  return (
    <Group gap={4} wrap="nowrap">
      <v.Icon size={size === 'xs' ? 14 : 16} color={v.color} stroke={2.2} aria-hidden />
      <Text size={size} fw={500}>
        {label ?? v.label}
      </Text>
    </Group>
  );
}

/** Компактный знак матрицы; название состояния доступно в ячейке и подсказке. */
export function RiskIcon({ risk, size = 14 }: { risk: SiteRisk; size?: number }) {
  const v = VIEW[risk];
  return <v.Icon size={size} color={v.color} stroke={2.2} aria-hidden style={{ flexShrink: 0 }} />;
}

export const riskColor = (risk: RiskLevel | SiteRisk) => VIEW[risk].color;
