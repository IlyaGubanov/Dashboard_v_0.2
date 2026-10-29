import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Card, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { SiteKpiRow } from '@mvs/shared';
import { directionQueries } from '../../api';
import { int, pct } from '../../ui/format';

/** Подложка карты. По умолчанию OpenStreetMap; для своего сервера тайлов — VITE_MAP_TILES при сборке. */
const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '© участники OpenStreetMap';

/** Замечания объекта: из отчёта (Благоустройство) или незакрытые в приложении. */
const remarksOf = (r: SiteKpiRow) => r.remarks ?? r.remarksOpen;
const radius = (r: SiteKpiRow) => 6 + Math.min(8, Math.sqrt(remarksOf(r)) * 2);

/** Карта объектов (OpenLayers): цвет — выполнено / в работе, размер — число замечаний. Щелчок — карточка объекта. */
export function MapTab({ code, date, onOpenSite }: { code: string; date?: string; onOpenSite: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.sites(code, date));
  const el = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ row: SiteKpiRow; x: number; y: number } | null>(null);
  const placed = (data ?? []).filter((r) => r.lat != null && r.lon != null);
  const missing = (data ?? []).filter((r) => r.lat == null || r.lon == null);

  useEffect(() => {
    if (!el.current || !placed.length) return;
    let destroy: (() => void) | null = null;
    let disposed = false;
    import('./olSitesMap').then(({ mountSitesMap }) => {
      if (disposed || !el.current) return;
      const css = getComputedStyle(document.documentElement);
      const done = css.getPropertyValue('--status-good').trim(), work = css.getPropertyValue('--series-1').trim();
      destroy = mountSitesMap(el.current, placed, {
        tiles: TILES,
        attribution: ATTRIBUTION,
        color: (r) => (r.risk === 'done' ? done : work),
        radius,
        onClick: onOpenSite,
        onHover: setHover,
      });
    });
    return () => {
      disposed = true;
      destroy?.();
      setHover(null);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={500} />;
  if (!placed.length) return <Alert color="gray">У объектов направления нет координат.</Alert>;

  return (
    <Stack>
      <Card withBorder padding={0}>
        <Box pos="relative">
          <Box ref={el} h={560} style={{ borderRadius: 'var(--mantine-radius-md) var(--mantine-radius-md) 0 0', overflow: 'hidden' }} aria-label="Карта объектов" />
          {hover && (
            <Paper
              shadow="md"
              withBorder
              p="xs"
              maw={280}
              style={{ position: 'absolute', left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 14px))', pointerEvents: 'none', zIndex: 2 }}
            >
              <Text size="sm" fw={600} lineClamp={2}>
                {hover.row.shortName}
              </Text>
              {(hover.row.statusText ?? hover.row.status?.name) && (
                <Text size="xs" c="dimmed">
                  {hover.row.statusText ?? hover.row.status?.name}
                </Text>
              )}
              <Text size="xs">
                выполнено {pct(hover.row.fact, 0)}
                {remarksOf(hover.row) ? ` · замечаний ${int(remarksOf(hover.row))}` : ''}
              </Text>
            </Paper>
          )}
        </Box>
        <Group p="sm" gap="lg">
          <Group gap={6}>
            <Box w={12} h={12} style={{ borderRadius: 6, background: 'var(--status-good)' }} />
            <Text size="xs">выполнено</Text>
          </Group>
          <Group gap={6}>
            <Box w={12} h={12} style={{ borderRadius: 6, background: 'var(--series-1)' }} />
            <Text size="xs">в работе</Text>
          </Group>
          <Text size="xs" c="dimmed">
            размер круга — число замечаний · {placed.length} из {data.length} объектов на карте
          </Text>
        </Group>
      </Card>
      {missing.length > 0 && (
        <Card withBorder padding="lg">
          <Text fw={600} mb={4}>
            Местоположение уточняется: {missing.length}
          </Text>
          {missing.map((r) => (
            <UnstyledButton key={r.id} className="row-link" px={6} py={4} display="block" onClick={() => onOpenSite(r.id)}>
              <Text size="sm">{r.shortName}</Text>
            </UnstyledButton>
          ))}
        </Card>
      )}
    </Stack>
  );
}
