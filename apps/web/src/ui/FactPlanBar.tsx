import { Box, Tooltip } from '@mantine/core';
import { pct } from './format';
import { Lag } from './Lag';

/**
 * Полоса «факт против плана»: заливка — факт, вертикальная метка — план на дату.
 * Цвет заливки — состояние (передаётся снаружи), подписи — рядом текстом.
 */
export function FactPlanBar({
  fact,
  plan,
  color,
  height = 10,
  label,
}: {
  fact: number | null;
  plan: number | null;
  color: string;
  height?: number;
  label?: string;
}) {
  const f = Math.max(0, Math.min(1, fact ?? 0));
  const p = plan == null ? null : Math.max(0, Math.min(1, plan));
  const tip = (
    <div>
      {label && <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>}
      <div>Факт: {pct(fact)}</div>
      {plan != null && (
        <>
          <div>План на дату: {pct(plan)}</div>
          <div>
            Отклонение: <Lag v={fact != null ? fact - plan : null} size="xs" />
          </div>
        </>
      )}
    </div>
  );
  return (
    <Tooltip label={tip} withArrow multiline w={220}>
      <Box
        role="img"
        aria-label={`Факт ${pct(fact)}${plan != null ? `, план ${pct(plan)}` : ''}`}
        py={6}
        style={{ position: 'relative', cursor: 'default' }}
      >
        <Box style={{ height, borderRadius: height / 2, background: 'var(--track)', overflow: 'hidden' }}>
          <Box style={{ width: `${f * 100}%`, height: '100%', background: color, borderRadius: height / 2 }} />
        </Box>
        {p != null && (
          <Box
            aria-hidden
            style={{
              position: 'absolute',
              left: `calc(${p * 100}% - 1px)`,
              top: 2,
              width: 2,
              height: height + 8,
              borderRadius: 1,
              background: 'var(--plan-mark)',
              boxShadow: '0 0 0 2px var(--mantine-color-body)',
            }}
          />
        )}
      </Box>
    </Tooltip>
  );
}
