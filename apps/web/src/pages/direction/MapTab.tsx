import { useEffect, useRef } from 'react';
import { Alert, Box, Card, Group, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { SiteKpiRow } from '@mvs/shared';
import { directionQueries } from '../../api';
import { int, pct } from '../../ui/format';

/** Подложка карты. По умолчанию OpenStreetMap; для своего сервера тайлов — VITE_MAP_TILES при сборке. */
const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '© участники OpenStreetMap';

const radius = (remarks: number | null) => 6 + Math.min(8, Math.sqrt(remarks ?? 0) * 2);

/** Карта объектов: цвет — выполнено / в работе, размер — число замечаний. Щелчок — карточка объекта. */
export function MapTab({ code, date, onOpenSite }: { code: string; date?: string; onOpenSite: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.sites(code, date));
  const el = useRef<HTMLDivElement>(null);
  const placed = (data ?? []).filter((r) => r.lat != null && r.lon != null);
  const missing = (data ?? []).filter((r) => r.lat == null || r.lon == null);

  useEffect(() => {
    if (!el.current || !placed.length) return;
    let map: import('leaflet').Map | null = null;
    let disposed = false;
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([L]) => {
      if (disposed || !el.current) return;
      const css = getComputedStyle(document.documentElement);
      const color = (r: SiteKpiRow) => (r.risk === 'done' ? css.getPropertyValue('--status-good') : css.getPropertyValue('--series-1')).trim();
      map = L.map(el.current, { scrollWheelZoom: true });
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
      const bounds = L.latLngBounds([]);
      for (const r of placed) {
        const ll = L.latLng(r.lat!, r.lon!);
        bounds.extend(ll);
        L.circleMarker(ll, { radius: radius(r.remarks), color: '#ffffff', weight: 2, fillColor: color(r), fillOpacity: 0.9 })
          .bindTooltip(
            `<b>${escapeHtml(r.shortName)}</b><br>${escapeHtml(r.statusText ?? '')}<br>выполнено ${pct(r.fact, 0)}` +
              (r.remarks ? ` · замечаний ${int(r.remarks)}` : ''),
            { direction: 'top' },
          )
          .on('click', () => onOpenSite(r.id))
          .addTo(map);
      }
      map.fitBounds(bounds.pad(0.15));
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={500} />;
  if (!placed.length) return <Alert color="gray">У объектов направления нет координат.</Alert>;

  return (
    <Stack>
      <Card withBorder padding={0}>
        <Box ref={el} h={560} style={{ borderRadius: 'var(--mantine-radius-md)', zIndex: 0 }} aria-label="Карта объектов" />
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
