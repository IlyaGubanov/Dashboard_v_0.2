import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, Group, Paper, Text, useComputedColorScheme } from '@mantine/core';
import { IconFocusCentered } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import type { MapSite, ObjectsMap } from '@mvs/shared';
import type { SitesMapController } from './olSitesMap';
import { MapSiteInfo } from './MapSiteInfo';

const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '© участники OpenStreetMap';
export function ObjectsMapCanvas({ sites, directions, onSelect }: { sites: MapSite[]; directions: ObjectsMap['directions']; onSelect: (rows: MapSite[]) => void }) {
  const el = useRef<HTMLDivElement>(null), controller = useRef<SitesMapController | null>(null);
  const latest = useRef({ directions, onSelect }); latest.current = { directions, onSelect };
  const [ready, setReady] = useState(false), [error, setError] = useState(false);
  const [hover, setHover] = useState<{ row: MapSite; x: number; y: number } | null>(null);
  const scheme = useComputedColorScheme('light');
  const touch = useMediaQuery('(hover: none)');
  useEffect(() => {
    let disposed = false;
    import('./olSitesMap').then(({ mountSitesMap }) => {
      if (disposed || !el.current) return;
      controller.current = mountSitesMap(el.current, {
        tiles: TILES, attribution: ATTRIBUTION,
        color: (r) => latest.current.directions.find((d) => d.code === r.directionCode)?.color || getComputedStyle(document.documentElement).getPropertyValue('--status-none').trim(),
        onClick: (rows) => latest.current.onSelect(rows), onHover: setHover,
      });
      setReady(true);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; controller.current?.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { if (ready) controller.current?.update(sites); }, [sites, directions, scheme, ready]);
  return (
    <Card withBorder p={0}>
      <Group p="sm" justify="space-between">
        <Text size="sm">На карте: {sites.length}</Text>
        <Button size="xs" variant="default" leftSection={<IconFocusCentered size={16} />} onClick={() => controller.current?.fit()} disabled={!ready || !sites.length}>Показать все</Button>
      </Group>
      {error && <Alert color="red">Карта не загрузилась. Объекты доступны в списке ниже.</Alert>}
      <Box pos="relative" style={{ minWidth: 0 }}>
        <Box ref={el} role="region" aria-label="Карта объектов" h="clamp(360px, 58vh, 820px)" style={{ overflow: 'hidden' }} />
        {!ready && !error && <Text pos="absolute" top={16} left={16} role="status">Загрузка карты…</Text>}
        {hover && !touch && <Paper role="tooltip" data-map-tooltip withBorder shadow="md" p="sm" w="min(300px, calc(100% - 24px))" onPointerLeave={()=>setHover(null)} style={{ position: 'absolute', top: 12,
          left: `clamp(12px, ${hover.x + 12}px, max(12px, calc(100% - 312px)))`, maxHeight:'calc(100% - 24px)', overflowY:'auto', zIndex: 2 }}>
          <MapSiteInfo site={hover.row} />
        </Paper>}
      </Box>
    </Card>
  );
}
