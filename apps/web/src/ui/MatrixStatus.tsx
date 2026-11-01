import type { CSSProperties } from 'react';
import { Group } from '@mantine/core';
import type { SiteRisk, WorkGrid } from '@mvs/shared';
import { RiskBadge, riskColor } from './RiskBadge';

type Item = WorkGrid['sites'][number]['items'][number];

/** Процент остаётся средним; подтверждённый риск важнее среднего и пробелов в данных. */
export function matrixCell(items: Item[]) {
  const live = items.filter((i) => !i.excluded);
  if (!live.length) return null;
  const fact = live.reduce((a, i) => a + i.fact, 0) / live.length;
  const withPlan = live.filter((i) => i.plan != null);
  const plan = withPlan.length ? withPlan.reduce((a, i) => a + i.plan!, 0) / withPlan.length : null;
  const risks = live.map((i) => i.risk ?? 'na');
  const risk: SiteRisk = risks.includes('crit') ? 'crit' : risks.includes('warn') ? 'warn'
    : risks.includes('na') ? 'na' : risks.every((r) => r === 'done') ? 'done'
    : risks.includes('ok') || risks.includes('done') ? 'ok' : 'wait';
  // куда вести из ячейки: цвет задаёт самая проблемная позиция — к ней и переходим
  const focus = live.find((i) => i.risk === 'crit') ?? live.find((i) => i.risk === 'warn') ?? live[0];
  return { fact, plan, risk, overdue: live.some((i) => i.overdue), items: live, focus };
}

export const matrixStatusStyle = (risk: SiteRisk): CSSProperties => ({ '--matrix-status': riskColor(risk) } as CSSProperties);

export function MatrixLegend({ trackers = false }: { trackers?: boolean }) {
  return (
    <Group gap="sm" wrap="wrap" aria-label="Светофор матрицы">
      <RiskBadge size="xs" risk="ok" label={trackers ? 'Выполнено' : 'В графике / выполнено'} />
      <RiskBadge size="xs" risk="warn" label={trackers ? 'Просрочено' : 'Отставание'} />
      {!trackers && <RiskBadge size="xs" risk="crit" />}
      <RiskBadge size="xs" risk="na" label={trackers ? 'Нет данных / срок не наступил' : 'Нет графика / данных / не начато'} />
    </Group>
  );
}
