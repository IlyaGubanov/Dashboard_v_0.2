import { useMemo, useState } from 'react';
import { Accordion, Alert, Badge, Box, Button, Card, Group, Modal, MultiSelect, Pagination, ScrollArea, Skeleton, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { IconMapPin, IconRefresh, IconX } from '@tabler/icons-react';
import { filterMapSites, hasMapCoordinates, mapEntityKey, normalizeMapFilters, type MapFilters, type MapSite, type ObjectsMap } from '@mvs/shared';
import { objectsMapQuery } from '../api';
import { ObjectsMapCanvas } from './map/ObjectsMapCanvas';
import { SiteDrawer } from './direction/SiteDrawer';
import { RemarkDrawer } from './direction/RemarkDrawer';

interface MapSearch extends MapFilters { code?: string; site?: number; remark?: number }
export function parseMapSearch(s: Record<string, unknown>): MapSearch {
  const values = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length < 256))].slice(0, 1000) : [];
  const id = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
  return { directions: values(s.directions), sections: values(s.sections), workTypes: values(s.workTypes),
    code: typeof s.code === 'string' ? s.code : undefined, site: id(s.site), remark: id(s.remark) };
}
const route = getRouteApi('/app/map');
const EMPTY: ObjectsMap = { directions: [], sites: [], workTypes: [] };

/** Карта — инструмент. Фильтры и карточка в URL; доступ определяет сервер. */
export function MapPage() {
  const query = useQuery(objectsMapQuery), data = query.data ?? EMPTY;
  const search = route.useSearch(), navigate = route.useNavigate();
  const [choices, setChoices] = useState<MapSite[]>([]);
  const filters = useMemo(() => normalizeMapFilters(data, search), [data, search]);
  const rows = useMemo(() => filterMapSites(data.sites, filters), [data.sites, filters]);
  const placed = useMemo(() => rows.filter(hasMapCoordinates), [rows]);
  const missing = useMemo(() => rows.filter((s) => !hasMapCoordinates(s)), [rows]);
  const names = new Map(data.directions.map((d) => [d.code, d.name]));
  const active = new Set(filters.directions.length ? filters.directions : data.directions.map((d) => d.code));
  const sections = [...new Map(data.sites.filter((s) => active.has(s.directionCode) && s.section).map((s) => [mapEntityKey(s.directionCode, s.section!.id),
    { value: mapEntityKey(s.directionCode, s.section!.id), label: `${s.section!.name} · ${names.get(s.directionCode)}` }])).values()];
  const workTypes = data.workTypes.filter((w) => active.has(w.directionCode)).map((w) => ({ value: mapEntityKey(w.directionCode, w.id), label: `${w.name} · ${names.get(w.directionCode)}` }));
  const set = (patch: Partial<MapSearch>) => navigate({ search: (s) => ({ ...s, ...patch }) });
  const changeFilters = (patch: Partial<MapFilters>) => { setChoices([]); set(normalizeMapFilters(data, { ...filters, ...patch })); };
  const open = (s: MapSite) => { setChoices([]); set({ code: s.directionCode, site: s.id, remark: undefined }); };
  const select = (sites: MapSite[]) => { if (sites.length === 1) open(sites[0]); else setChoices(sites); };
  const selected = data.sites.find((s) => s.directionCode === search.code && s.id === search.site);
  const drawerCode = data.directions.find((d) => d.code === search.code)?.code;
  const choiceKeys = new Set(rows.map((s) => mapEntityKey(s.directionCode, s.id)));
  const visibleChoices = choices.filter((s) => choiceKeys.has(mapEntityKey(s.directionCode, s.id)));

  return <Stack gap="md">
    <Group justify="space-between">
      <div><Title order={2}>Карта объектов</Title><Text size="sm" c="dimmed">Все доступные направления</Text></div>
      <Button variant="default" size="xs" leftSection={<IconRefresh size={16} />} loading={query.isFetching} onClick={() => query.refetch()}>Обновить</Button>
    </Group>
    {query.error && <Alert color="red">{(query.error as Error).message}</Alert>}
    {query.isLoading ? <Skeleton h={480} /> : <>
      {!data.directions.length && <Alert color="gray">Нет доступных направлений. Обратитесь к администратору.</Alert>}
      <Card withBorder p="md">
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
          <MultiSelect label="Направление" placeholder="Все направления" searchable clearable value={filters.directions}
            data={data.directions.map((d) => ({ value: d.code, label: d.name }))} onChange={(directions) => changeFilters({ directions })} />
          <MultiSelect label="Раздел" placeholder={sections.length ? 'Все разделы' : 'Разделы не заданы'} searchable clearable value={filters.sections}
            data={sections} onChange={(sections) => changeFilters({ sections })} disabled={!sections.length} />
          <MultiSelect label="Вид работ" placeholder={workTypes.length ? 'Все виды работ' : 'Виды работ не заданы'} searchable clearable value={filters.workTypes}
            data={workTypes} onChange={(workTypes) => changeFilters({ workTypes })} disabled={!workTypes.length} />
        </Box>
        <Group justify="space-between" mt="sm">
          <Text size="sm" role="status" aria-live="polite">Найдено объектов: {rows.length} · На карте: {placed.length} · Без координат: {missing.length}</Text>
          <Button variant="subtle" size="xs" leftSection={<IconX size={14} />} onClick={() => changeFilters({ directions: [], sections: [], workTypes: [] })}>Сбросить фильтры</Button>
        </Group>
      </Card>
      {!rows.length && <Alert color="gray">Объекты не найдены. Измените или сбросьте фильтры.</Alert>}
      <ObjectsMapCanvas sites={placed} directions={data.directions} onSelect={select} />
      <Group gap="md" aria-label="Легенда направлений">
        {data.directions.filter((d) => active.has(d.code)).map((d) => <Group key={d.code} gap={6}>
          <IconMapPin size={17} color={d.color || 'var(--status-none)'} aria-hidden="true" />
          <Text size="xs">{d.name}{!d.color ? ' · цвет не задан' : ''}</Text>
        </Group>)}
      </Group>
      <Accordion variant="contained"><Accordion.Item value="mapped"><Accordion.Control>Список объектов на карте · {placed.length}</Accordion.Control>
        <Accordion.Panel><SitesList key={`mapped|${JSON.stringify(filters)}`} sites={placed} names={names} onOpen={open} /></Accordion.Panel>
      </Accordion.Item></Accordion>
      <Card withBorder p="md"><Group gap="sm" mb="sm"><Text fw={600}>Объекты без координат</Text><Badge variant="light" color="gray">{missing.length}</Badge></Group>
        <SitesList key={`missing|${JSON.stringify(filters)}`} sites={missing} names={names} onOpen={open} />
      </Card>
    </>}
    <Modal opened={visibleChoices.length > 1} onClose={() => setChoices([])} title="Выберите объект в этой точке" zIndex={400}>
      <ScrollArea.Autosize mah={420}><Stack gap={4}>{visibleChoices.map((s) => <UnstyledButton key={mapEntityKey(s.directionCode, s.id)} className="row-link" p="sm" onClick={() => open(s)}>
        <Text size="sm" fw={500}>{s.name}</Text><Text size="xs" c="dimmed">{names.get(s.directionCode)}{s.section ? ` · ${s.section.name}` : ''}</Text>
      </UnstyledButton>)}</Stack></ScrollArea.Autosize>
    </Modal>
    <SiteDrawer key={drawerCode ?? ''} code={drawerCode ?? ''} siteId={selected?.id}
      onClose={() => set({ code: undefined, site: undefined, remark: undefined })}
      onEditSite={(id) => { if (drawerCode) navigate({ to: '/d/$code', params: { code: drawerCode }, search: { tab: 'manage', edit: id } }); }}
      onOpenRemark={(remark) => set({ remark })} />
    <RemarkDrawer key={`remark|${drawerCode ?? ''}`} code={drawerCode ?? ''} remarkId={drawerCode ? search.remark : undefined}
      onClose={() => set({ remark: undefined })} onOpenSite={(site) => set({ site, remark: undefined })} />
  </Stack>;
}

function SitesList({ sites, names, onOpen }: { sites: MapSite[]; names: Map<string, string>; onOpen: (s: MapSite) => void }) {
  const [page, setPage] = useState(1);
  const count = Math.max(1, Math.ceil(sites.length / 50)), current = Math.min(page, count);
  if (!sites.length) return <Text size="sm" c="dimmed">Нет объектов в этой выборке.</Text>;
  return <Stack gap="xs">
    {sites.slice((current - 1) * 50, current * 50).map((s) => <UnstyledButton key={mapEntityKey(s.directionCode, s.id)} className="row-link" p="xs" onClick={() => onOpen(s)}>
      <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>{s.name}</Text>
      <Text size="xs" c="dimmed">{names.get(s.directionCode)}{s.section ? ` · ${s.section.name}` : ''}</Text>
    </UnstyledButton>)}
    {count > 1 && <Pagination size="sm" total={count} value={current} onChange={setPage} aria-label="Страницы списка объектов" />}
  </Stack>;
}
