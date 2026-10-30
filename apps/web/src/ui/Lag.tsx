import { Text, type MantineSize } from '@mantine/core';
import { IconExclamationCircle } from '@tabler/icons-react';
import { pp } from './format';

/** Отклонение ниже нуля после округления до 0,1 п.п. — это отставание. */
export const isLag = (v: number | null | undefined) => v != null && v * 100 < -0.05;

/** Значок отставания «!»: жёлтый — отставание, красный — критично. */
export function LagIcon({ crit, size = 16 }: { crit?: boolean; size?: number }) {
  return (
    <IconExclamationCircle
      size={size}
      stroke={2.2}
      color={crit ? 'var(--status-critical)' : 'var(--status-warning)'}
      style={{ flexShrink: 0 }}
      aria-label={crit ? 'критичное отставание' : 'отставание'}
    />
  );
}

/**
 * Отклонение факта от плана, п.п. Отставание — всегда со знаком «−» и значком «!».
 * Строчный элемент: выравнивается по тексту ячейки (ta="right" и т.п.).
 */
export function Lag({ v, crit, size = 'sm', fw }: { v: number | null | undefined; crit?: boolean; size?: MantineSize; fw?: number }) {
  if (!isLag(v))
    return (
      <Text span size={size} fw={fw} style={{ whiteSpace: 'nowrap' }}>
        {pp(v)}
      </Text>
    );
  return (
    <Text span size={size} fw={fw ?? 600} style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
      <LagIcon crit={crit} size={size === 'xs' ? 14 : 16} />
      {pp(v)}
    </Text>
  );
}
