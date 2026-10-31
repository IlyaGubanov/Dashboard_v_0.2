import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Badge, Box, Button, Group, MultiSelect, Pagination, Paper, SegmentedControl, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconMaximize, IconRefresh, IconVideo } from '@tabler/icons-react';
import type { CameraItem } from '@mvs/shared';
import { attachLive, type LiveState } from './live-player';
import './video.css';

function CameraTile({ camera, siteName }: { camera: CameraItem; siteName?: string }) {
  const wrapper = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [activePage, setActivePage] = useState(!document.hidden);
  const [state, setState] = useState<LiveState>('Подключение');
  const [attempt, setAttempt] = useState(0);
  const [ratio, setRatio] = useState('4 / 3');
  const [fullscreenError, setFullscreenError] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (wrapper.current) observer.observe(wrapper.current);
    const change = () => setActivePage(!document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', change); };
  }, []);
  useEffect(() => {
    if (!video.current || !visible || !activePage || !camera.available || camera.syncState !== 'SYNCED') return;
    return attachLive(video.current, '/media/cam-' + camera.id + '/index.m3u8', setState).dispose;
  }, [camera.id, camera.version, camera.available, camera.syncState, visible, activePage, attempt]);
  const label = !camera.available ? 'Отключена' : camera.syncState === 'PENDING' ? 'Подключение' : camera.syncState !== 'SYNCED' ? 'Нет связи' : state;
  return <Paper ref={wrapper} className="video-camera" withBorder radius="md" p="xs" style={{ minWidth: 0 }} data-camera-id={camera.id}>
    <Group justify="space-between" gap="xs" wrap="nowrap" mb={6}>
      <Box style={{ minWidth: 0 }}><Text size="sm" fw={600} lineClamp={1}>{camera.name}</Text>{siteName && <Text size="xs" c="dimmed" lineClamp={1}>{siteName}</Text>}</Box>
      <Tooltip label="На весь экран"><ActionIcon variant="subtle" aria-label={'На весь экран: ' + camera.name} onClick={() => {
        setFullscreenError(false);
        const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        if (wrapper.current?.requestFullscreen) void wrapper.current.requestFullscreen().catch(() => setFullscreenError(true));
        else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
        else setFullscreenError(true);
      }}><IconMaximize size={17} /></ActionIcon></Tooltip>
    </Group>
    <Box className="video-frame" pos="relative" bg="#0b0f14" style={{ aspectRatio: ratio, overflow: 'hidden', borderRadius: 6 }}>
      <video ref={video} autoPlay muted playsInline aria-label={camera.name + ' — прямой эфир'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        onLoadedMetadata={() => { const v = video.current; if (v?.videoWidth && v.videoHeight) setRatio(v.videoWidth + ' / ' + v.videoHeight); }} />
      {(label !== 'В эфире' || !visible || !activePage) && <Stack pos="absolute" inset={0} align="center" justify="center" gap="xs" p="sm" style={{ background: '#0b0f14', color: '#dee2e6' }}>
        <IconVideo size={24} stroke={1.3} /><Text size="sm" role="status">{!activePage ? 'Приостановлено' : label}</Text>
        {camera.available && camera.syncState === 'SYNCED' && label !== 'Подключение' && <Button size="compact-xs" variant="light" leftSection={<IconRefresh size={13} />} onClick={() => { setState('Подключение'); setAttempt(a => a + 1); }}>Повторить</Button>}
      </Stack>}
    </Box>
    <Group justify="space-between" gap={4} mt={6}><Badge size="xs" color={label === 'В эфире' ? 'gray' : 'orange'} variant="light">{label}</Badge><Text size="xs" c="dimmed">Прямой эфир</Text></Group>
    {camera.syncError && <Text size="xs" c="red" mt={4}>{camera.syncError}</Text>}
    {state === 'Несовместимый формат' && <Text size="xs" c="dimmed" mt={4}>Для этой камеры нужен совместимый поток H.264.</Text>}
    {fullscreenError && <Text size="xs" c="dimmed">Полноэкранный режим недоступен в этом браузере.</Text>}
  </Paper>;
}
export function VideoBoard({ cameras, names = {} }: { cameras: CameraItem[]; names?: Record<number, string> }) {
  const mobile = useMediaQuery('(max-width: 47.99em)', false, { getInitialValueInEffect: false });
  const [layout, setLayout] = useState('4'), [page, setPage] = useState(1), [selected, setSelected] = useState<string[]>([]);
  const size = mobile ? 1 : Number(layout);
  const filtered = selected.length ? cameras.filter(c => selected.includes(String(c.id))) : cameras;
  const pages = Math.max(1, Math.ceil(filtered.length / size)), current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * size, current * size);
  if (!cameras.length) return <Alert color="gray" icon={<IconVideo size={18} />}>Камеры пока не настроены или не соответствуют выбранным фильтрам.</Alert>;
  return <Stack gap="sm">
    <Group justify="space-between" align="flex-end">
      <MultiSelect label="Выбор камер" placeholder="Все камеры" searchable clearable value={selected}
        data={cameras.map(c => ({ value: String(c.id), label: c.name + (names[c.siteId] ? ' · ' + names[c.siteId] : '') }))}
        onChange={v => { setSelected(v); setPage(1); }} style={{ flex: '1 1 220px', maxWidth: 520 }} />
      <Group gap="xs">{!mobile && <SegmentedControl aria-label="Раскладка камер" value={layout} data={['1', '4', '9']} onChange={v => { setLayout(v); setPage(1); }} />}
        <Text size="sm" c="dimmed">{filtered.length} камер</Text></Group>
    </Group>
    <SimpleGrid cols={mobile || size === 1 ? 1 : size === 4 ? 2 : 3} spacing="sm" style={{ alignItems: 'start' }}>
      {shown.map(c => <CameraTile key={c.id} camera={c} siteName={names[c.siteId]} />)}
    </SimpleGrid>
    {pages > 1 && <Group justify="center"><Pagination total={pages} value={current} onChange={setPage} size="sm" /></Group>}
  </Stack>;
}
