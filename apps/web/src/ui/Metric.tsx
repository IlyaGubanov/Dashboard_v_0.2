import { Text } from '@mantine/core';

/** Смысловой цвет плитки → CSS-переменная оформления (своя для светлой и тёмной тем); свой код цвета — как есть. */
const TOKEN_VARS: Record<string, string> = {
  primary: 'var(--mantine-primary-color-filled)',
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  series1: 'var(--series-1)',
  series2: 'var(--series-2)',
  series3: 'var(--series-3)',
};

/** Плитка показателя: вид, размеры и цвета — «Оформление», свой цвет плитки — конструктор направления («Плитки обзора»). */
export function Metric({ label, value, color }: { label: string; value: string; color?: string | null }) {
  const c = color ? (TOKEN_VARS[color] ?? color) : null;
  return (
    <div className="direction-metric" data-colored={c ? true : undefined} style={c ? ({ '--tile-color': c } as React.CSSProperties) : undefined}>
      {/* крупное число с единицей («5,08 млрд ₽») переносится по пробелу, а не вылезает за плитку */}
      <Text className="tile-value" fw={700} lh={1.2}>
        {value}
      </Text>
      <Text className="tile-label" c="dimmed" lh={1.2}>
        {label}
      </Text>
    </div>
  );
}
