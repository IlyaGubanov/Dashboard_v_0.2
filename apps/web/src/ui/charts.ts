/**
 * Готовые графики динамики. Правила: одна ось на график (разные меры — разные графики),
 * линии 2 px, точки 8 px, легенда при двух и более сериях, подсказка по оси.
 */
import type { EChartsOption } from 'echarts';
import type { DynamicsPoint } from '@mvs/shared';
import { baseOption, type ChartColors } from './EChart';
import { date, int, money, pct } from './format';

/** Подписи дат: «дд.мм», а если период захватывает несколько лет — «дд.мм.гг». */
const xLabels = (pts: DynamicsPoint[]) => {
  const years = new Set(pts.map((p) => p.date.slice(0, 4)));
  return pts.map((p) => date(p.date).slice(0, 5) + (years.size > 1 ? `.${p.date.slice(2, 4)}` : ''));
};

/** Готовность: факт против плана, %. */
export function factPlanChart(pts: DynamicsPoint[], c: ChartColors): EChartsOption {
  const hasPlan = pts.some((p) => p.plan != null);
  const b = baseOption(c);
  return {
    ...b,
    // одна серия — легенда не нужна, её называет заголовок
    legend: hasPlan ? b.legend : { show: false },
    grid: { ...(b.grid as object), top: hasPlan ? 36 : 12 },
    tooltip: { ...(b.tooltip as object), valueFormatter: (v) => (v == null ? '—' : pct(Number(v) / 100)) },
    xAxis: { type: 'category', data: xLabels(pts), axisLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: c.muted, formatter: '{value} %' },
      splitLine: { lineStyle: { color: c.grid, opacity: 0.6 } },
    },
    series: [
      {
        name: 'Факт',
        type: 'line',
        data: pts.map((p) => (p.fact == null ? null : +(p.fact * 100).toFixed(2))),
        color: c.series[0],
        lineStyle: { width: 2 },
        symbolSize: pts.length > 40 ? 0 : 8,
        connectNulls: true,
        areaStyle: { opacity: 0.08 },
      },
      ...(hasPlan
        ? [
            {
              name: 'План',
              type: 'line' as const,
              data: pts.map((p) => (p.plan == null ? null : +(p.plan * 100).toFixed(2))),
              color: c.plan,
              lineStyle: { width: 2, type: 'dashed' as const },
              symbolSize: 0,
              connectNulls: true,
            },
          ]
        : []),
    ],
  };
}

/** Одна мера по точкам: люди, техника, деньги. */
export function seriesChart(
  pts: DynamicsPoint[],
  c: ChartColors,
  lines: { name: string; key: keyof DynamicsPoint; color: string }[],
  kind: 'count' | 'money',
): EChartsOption {
  const b = baseOption(c);
  const fmt = (v: unknown) => (v == null ? '—' : kind === 'money' ? money(Number(v)) : int(Number(v)));
  return {
    ...b,
    legend: lines.length > 1 ? b.legend : { show: false },
    grid: { ...(b.grid as object), top: lines.length > 1 ? 36 : 12 },
    tooltip: { ...(b.tooltip as object), valueFormatter: fmt },
    xAxis: { type: 'category', data: xLabels(pts), axisLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
    yAxis: {
      type: 'value',
      axisLabel: { color: c.muted, formatter: (v: number) => (kind === 'money' ? `${Math.round(v / 1e6)} млн` : int(v)) },
      splitLine: { lineStyle: { color: c.grid, opacity: 0.6 } },
    },
    series: lines.map((l) => ({
      name: l.name,
      type: 'line' as const,
      data: pts.map((p) => p[l.key] as number | null),
      color: l.color,
      lineStyle: { width: 2 },
      symbolSize: pts.length > 40 ? 0 : 8,
      connectNulls: true,
    })),
  };
}
