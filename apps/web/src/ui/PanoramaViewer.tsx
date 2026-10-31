import { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Box, Button, Group, Text } from '@mantine/core';
import { IconArrowsMaximize, IconMinus, IconPlus } from '@tabler/icons-react';
import type { Attachment } from '@mvs/shared';
import 'pannellum/build/pannellum.js';
import 'pannellum/build/pannellum.css';

interface Viewer { destroy(): void; resize(): void; getHfov(): number; setHfov(value: number): void; setUpdate(value: boolean): void; on(event: string, fn: (value?: string) => void): void }
declare global { interface Window { pannellum: { viewer: (target: HTMLElement, options: Record<string, unknown>) => Viewer } } }

/** WebGL и библиотека загружаются только при открытии снимка. Исходник остаётся доступен отдельно. */
export default function PanoramaViewer({ file }: { file: Attachment }) {
  const target = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), viewer = useRef<Viewer | null>(null);
  const [error, setError] = useState(false), [ready, setReady] = useState(false);
  useEffect(()=>{
    if (!target.current) return;
    let instance: Viewer | undefined, objectUrl: string | undefined, disposed=false;
    const abort=new AbortController(), image=new window.Image();
    const resize=new ResizeObserver(()=>instance?.resize()); resize.observe(target.current);
    const load=async()=>{try {
      // Контролируем загрузку: destroy() самой библиотеки не отменяет её внутренний XHR.
      const response=await fetch(`/api/attachments/${file.id}/file?variant=viewer`,{credentials:'same-origin',signal:abort.signal});
      if(!response.ok)throw new Error('file');
      const blob=await response.blob();if(disposed)return;
      objectUrl=URL.createObjectURL(blob);image.src=objectUrl;await image.decode();
      if(disposed||!target.current)return;
      instance = window.pannellum.viewer(target.current, { type: 'equirectangular', panorama: image, dynamic:true, dynamicUpdate:false, autoLoad: true,
        showControls: false, mouseZoom: true, draggable: true, keyboardZoom: true, escapeHTML: true, crossOrigin: 'use-credentials',
        strings: { loadingLabel: 'Загрузка панорамы…', genericWebGLError: 'Не удалось открыть панораму. Доступен оригинальный файл.', noWebGLError: 'Просмотр 360° требует WebGL. Доступен оригинальный файл.' } });
      viewer.current=instance; instance.on('load',()=>{if(!disposed)setReady(true);}); instance.on('error',()=>{if(!disposed)setError(true);});
      instance.setUpdate(false);
    } catch { if(!disposed)setError(true); }};
    void load();
    return ()=>{disposed=true;abort.abort();resize.disconnect();viewer.current=null;instance?.destroy();image.src='';if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[file.id]);
  return <Box ref={frame} bg="var(--surface-muted)" style={{display:'flex',flexDirection:'column',minHeight:0}}>
    <Box ref={target} h="clamp(280px, 60vh, 850px)" role="region" aria-label="Панорама 360°: вращение мышью, касанием или стрелками" style={{flex:'1 1 auto'}} />
    {!ready&&!error && <Text size="xs" p="xs" role="status">Загрузка панорамы…</Text>}
    {error && <Alert color="orange">Просмотр панорамы недоступен в этом браузере. Скачайте оригинальный файл.</Alert>}
    <Group p="xs" justify="space-between"><Text size="xs" c="dimmed">Поворачивайте мышью или касанием · масштаб — колесом</Text><Group gap="xs">
      <Button size="compact-sm" variant="default" aria-label="Приблизить панораму" disabled={!ready} onClick={()=>{const v=viewer.current;if(v)v.setHfov(Math.max(30,v.getHfov()-15));}}><IconPlus size={16}/></Button>
      <Button size="compact-sm" variant="default" aria-label="Отдалить панораму" disabled={!ready} onClick={()=>{const v=viewer.current;if(v)v.setHfov(Math.min(120,v.getHfov()+15));}}><IconMinus size={16}/></Button>
      <Button size="compact-sm" variant="default" leftSection={<IconArrowsMaximize size={16}/>} onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await frame.current?.requestFullscreen();}catch{setError(true);}}}>Полный экран</Button>
    </Group></Group>
    <Anchor href="/licenses/pannellum.txt" target="_blank" rel="noopener" size="xs" p="xs">Pannellum · лицензия MIT</Anchor>
  </Box>;
}
