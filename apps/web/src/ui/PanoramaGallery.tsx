import { lazy, Suspense, useState } from 'react';
import { ActionIcon, Alert, Button, FileButton, Group, Image, Modal, Select, SimpleGrid, Skeleton, Stack, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArchive, IconView360 } from '@tabler/icons-react';
import { attachmentMaterialSchema, type Attachment } from '@mvs/shared';
import { api } from '../api';
import { uploadFile } from './attachments';
import { date } from './format';

const PanoramaViewer = lazy(() => import('./PanoramaViewer'));
export function PanoramaGallery({ files, siteId, canUpload, onChanged }: { files: Attachment[]; siteId: number; canUpload: boolean; onChanged: () => void }) {
  const [uploading, setUploading] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState<File[]>([]);
  const [capturedOn, setCapturedOn] = useState(''), [description, setDescription] = useState(''), [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null), [page, setPage] = useState(1);
  const ordered = [...files].sort((a,b) => (b.capturedOn ?? '').localeCompare(a.capturedOn ?? '') || b.createdAt.localeCompare(a.createdAt) || b.id-a.id);
  const current = ordered.find(f => f.id === selected);
  const save = async () => {
    const parsed = attachmentMaterialSchema.safeParse({ materialType: 'PANORAMA360', capturedOn, description });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!pending.length) { setError('Выберите панорамные снимки'); return; }
    setBusy(true); setError('');
    const failed: File[] = [];
    for (const file of pending) {
      try { await uploadFile('site', siteId, file, parsed.data); }
      catch (e) { failed.push(file); setError(e instanceof Error ? e.message : 'Ошибка загрузки'); }
    }
    setPending(failed); setBusy(false); onChanged();
    if (!failed.length) { setUploading(false); setDescription(''); }
  };
  const archive = async (f: Attachment) => {
    if (!confirm(`Убрать «${f.fileName}» в архив?`)) return;
    try { await api(`/attachments/${f.id}/archive`, { method: 'POST' }); setSelected(null); onChanged(); }
    catch (e) { notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Ошибка' }); }
  };
  return <Stack gap="sm">
    <Group justify="space-between"><Text fw={600}>Панорамы 360° · {files.length}</Text>{canUpload && <Button size="xs" variant="light" leftSection={<IconView360 size={16} />} onClick={() => setUploading(true)}>Добавить панораму 360°</Button>}</Group>
    {!files.length && <Text size="sm" c="dimmed">Панорам пока нет. Снимки сохраняются в истории объекта независимо от отчётного периода.</Text>}
    <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">{ordered.slice(0,page*18).map(f => <UnstyledButton key={f.id} onClick={() => setSelected(f.id)} aria-label={`Открыть панораму ${date(f.capturedOn)}: ${f.description || f.fileName}`}>
      <Image src={`/api/attachments/${f.id}/file?variant=preview`} alt="Сферическая панорама" fit="contain" h={90} loading="lazy" bg="var(--surface-muted)" radius="sm" />
      <Text mt={4} size="xs" fw={500}>{date(f.capturedOn)}</Text>
      <Text size="xs" c="dimmed" lineClamp={2}>{f.description || f.fileName}</Text>
    </UnstyledButton>)}</SimpleGrid>
    {ordered.length > page*18 && <Button variant="subtle" size="xs" onClick={() => setPage(p=>p+1)}>Показать ещё снимки</Button>}
    <Modal opened={uploading} onClose={() => { if (!busy) setUploading(false); }} title="Добавить панорамы 360°" zIndex={400} closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
      <Stack><Text size="sm" c="dimmed">Панорамный снимок JPEG, PNG или WebP с соотношением сторон 2:1, до 50 МБ. Изображение автоматически оптимизируется.</Text>
        <TextInput label="Дата съёмки" type="date" required value={capturedOn} onChange={e=>setCapturedOn(e.currentTarget.value)} disabled={busy} />
        <Textarea label="Описание" maxLength={1000} value={description} onChange={e=>setDescription(e.currentTarget.value)} disabled={busy} />
        <FileButton accept="image/jpeg,image/png,image/webp" multiple onChange={setPending}>{p=><Button {...p} variant="default" disabled={busy}>Выбрать снимки</Button>}</FileButton>
        {pending.map((f,i)=><Text key={i} size="xs" style={{overflowWrap:'anywhere'}}>{f.name} · {(f.size/1024/1024).toFixed(1)} МБ</Text>)}
        {error && <Alert color="red">{error}</Alert>}<Button onClick={save} loading={busy}>Загрузить панорамы</Button>
      </Stack>
    </Modal>
    <Modal opened={!!current} onClose={()=>setSelected(null)} size="90%" title="Панорамы объекта" zIndex={400}>
      {current && <Stack gap="sm">
        <Select label="Снимок и дата съёмки" value={String(current.id)} onChange={id=>setSelected(id?Number(id):null)} comboboxProps={{zIndex:1000}} data={ordered.map(f=>({value:String(f.id),label:`${date(f.capturedOn)} · ${f.description || f.fileName} · № ${f.id}`}))} />
        <Suspense fallback={<Skeleton h={420} />}><PanoramaViewer key={current.id} file={current} /></Suspense>
        <Text size="sm">{date(current.capturedOn)}{current.description ? ` · ${current.description}` : ''}</Text>
        <Group justify="space-between"><Text size="xs" c="dimmed">Загрузил: {current.uploadedBy || 'Не указан'} · {new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(current.createdAt))}</Text><Group gap="xs">
          <Button component="a" href={`/api/attachments/${current.id}/file?download=1`} size="xs" variant="default">Скачать панораму</Button>
          {current.canArchive && <ActionIcon aria-label="Убрать панораму в архив" color="orange" variant="light" onClick={()=>archive(current)}><IconArchive size={16} /></ActionIcon>}
        </Group></Group>
      </Stack>}
    </Modal>
  </Stack>;
}
