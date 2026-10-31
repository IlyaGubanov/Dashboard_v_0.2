import { Badge, Box, Group, Image, Text } from '@mantine/core';
import type { MapSite } from '@mvs/shared';
import { date } from '../../ui/format';

export function MapSiteInfo({ site }: { site: MapSite }) {
  return <>
    <Text fw={600} size="sm">{site.name}</Text>
    {site.panorama && <Box mt={8}>
      <Image src={`/api/attachments/${site.panorama.id}/file?variant=preview`} alt={`Панорама объекта от ${date(site.panorama.capturedOn)}`} h={130} fit="contain" radius="sm" loading="lazy" bg="var(--surface-muted)" />
      <Group gap={6} mt={4}><Badge size="xs" variant="light">360°</Badge><Text size="xs">{date(site.panorama.capturedOn)}{site.panorama.count>1?` · ещё ${site.panorama.count-1}`:''}</Text></Group>
    </Box>}
    <Text size="xs" mt={6}>Люди: {site.people == null ? 'Нет данных' : site.people.toLocaleString('ru-RU')}</Text>
    <Text size="xs">Техника: {site.tech == null ? 'Нет данных' : site.tech.toLocaleString('ru-RU')}</Text>
    <Text size="xs" fw={600} mt={6}>Ответственный</Text>
    {!site.responsibles.length ? <Text size="xs">Не назначен</Text> : site.responsibles.map(p=><Box key={p.id} mt={4}>
      <Text size="xs" fw={500}>{p.fullName}</Text><Text size="xs">{p.position || 'Должность не указана'}</Text><Text size="xs">{p.phone || 'Телефон не указан'}</Text>
    </Box>)}
  </>;
}
