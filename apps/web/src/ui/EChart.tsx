import { useEffect, useRef, useState } from 'react';
import { Box, Loader, useComputedColorScheme } from '@mantine/core';
import type { EChartsOption, EChartsType } from 'echarts';

/** Цвета графика из темы (theme.css + Mantine) — меняются вместе со светлой/тёмной темой. */
export interface ChartColors {
  series: [string, string, string];
  good: string;
  warning: string;
  critical: string;
  text: string;
  muted: string;
  grid: string;
  plan: string;
  surface: string;
}

function readColors(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    series: [v('--series-1'), v('--series-2'), v('--series-3')],
    good: v('--status-good'),
    warning: v('--status-warning'),
    critical: v('--status-critical'),
    text: v('--mantine-color-text'),
    muted: v('--mantine-color-dimmed'),
    grid: v('--mantine-color-default-border'),
    plan: v('--plan-mark'),
    surface: v('--mantine-color-body'),
  };
}

/** Общие настройки: подсказка по оси, тонкие линии, приглушённая сетка, без анимации прыжков. */
export function baseOption(c: ChartColors): EChartsOption {
  return {
    animation: false,
    textStyle: { fontFamily: 'Montserrat, "Segoe UI", Arial, sans-serif', color: c.text, fontSize: 12 },
    grid: { left: 12, right: 20, top: 42, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      padding: [10, 14],
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: c.muted } },
    },
    legend: { top: 0, left: 0, itemGap: 20, icon: 'roundRect', itemWidth: 16, itemHeight: 4, textStyle: { color: c.text, fontSize: 12 } },
  };
}

let echartsModule: Promise<typeof import('echarts')> | null = null;
const loadEcharts = () => (echartsModule ??= import('echarts'));

/**
 * График ECharts. Библиотека загружается при первом показе (не утяжеляет вход в приложение).
 * option строится из цветов темы и пересобирается при смене темы.
 */
export function EChart({ option, height = 280, ariaLabel }: { option: (c: ChartColors) => EChartsOption; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const scheme = useComputedColorScheme('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    loadEcharts().then((echarts) => {
      if (disposed || !ref.current) return;
      chart.current = echarts.init(ref.current, undefined, { renderer: 'svg' });
      ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !chart.current) return;
    // цвета темы применяются после того, как Mantine обновил атрибут схемы
    const id = requestAnimationFrame(() => chart.current?.setOption(option(readColors()), true));
    return () => cancelAnimationFrame(id);
  }, [ready, option, scheme]);

  return (
    <Box pos="relative" h={height} role="img" aria-label={ariaLabel}>
      <div ref={ref} style={{ width: '100%', height: '100%', touchAction: 'pan-y' }} />
      {!ready && <Loader size="sm" pos="absolute" top="45%" left="50%" />}
    </Box>
  );
}
