import { useState } from 'react';
import { ActionIcon, Anchor, Button, FileButton, Group, Image, Modal, SimpleGrid, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArchive, IconCamera, IconFile, IconFileTypePdf, IconPaperclip } from '@tabler/icons-react';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_MB, PANORAMA_MAX_MB, type Attachment, type AttachmentEntity, type AttachmentMaterial } from '@mvs/shared';
import { api, ApiError } from '../api';
import { date } from './format';

const MAX_SIDE = 2000;
const fileUrl = (id: number) => `/api/attachments/${id}/file`;

/** Фото с телефона (5–10 МБ) уменьшаются до 2000 px по большей стороне — грузятся быстрее, место на сервере не тратят. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function uploadFile(entity: AttachmentEntity, entityId: number, original: File, material: AttachmentMaterial = { materialType: 'FILE' }): Promise<Attachment> {
  const file = material.materialType === 'PANORAMA360' ? original : await shrink(original);
  const max = material.materialType === 'PANORAMA360' ? PANORAMA_MAX_MB : ATTACHMENT_MAX_MB;
  if (file.size > max * 1024 * 1024) throw new ApiError(413, `«${file.name}» больше ${max} МБ`);
  const params = new URLSearchParams({ entity, entityId: String(entityId), name: file.name, materialType: material.materialType });
  if (material.materialType === 'PANORAMA360') { params.set('capturedOn', material.capturedOn); if (material.description) params.set('description', material.description); }
  const res = await fetch(`/api/attachments?${params}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, `«${file.name}»: ${data.message ?? `ошибка ${res.status}`}`);
  return data as Attachment;
}

/** Загрузить несколько файлов; ошибки показываются уведомлениями, успешные возвращаются. */
export async function uploadMany(entity: AttachmentEntity, entityId: number, files: File[]) {
  const done: Attachment[] = [];
  for (const f of files) {
    try {
      done.push(await uploadFile(entity, entityId, f));
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Не удалось загрузить файл' });
    }
  }
  return done;
}

/** Кнопки «Фото» (на телефоне сразу открывает камеру) и «Файл». */
export function AddFiles({ onFiles, busy, compact }: { onFiles: (files: File[]) => void; busy?: boolean; compact?: boolean }) {
  return (
    <Group gap="xs">
      <FileButton onChange={onFiles} accept="image/*" multiple capture="environment">
        {(p) => (
          <Button {...p} size="xs" variant="light" loading={busy} leftSection={<IconCamera size={14} />}>
            {compact ? 'Фото' : 'Сделать фото'}
          </Button>
        )}
      </FileButton>
      <FileButton onChange={onFiles} accept={ATTACHMENT_ACCEPT} multiple>
        {(p) => (
          <Button {...p} size="xs" variant="subtle" loading={busy} leftSection={<IconPaperclip size={14} />}>
            {compact ? 'Файл' : 'Приложить файл'}
          </Button>
        )}
      </FileButton>
    </Group>
  );
}

/** Выбранные, но ещё не загруженные файлы. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <Group gap={6}>
      {files.map((f, i) => (
        <Button key={i} size="compact-xs" variant="default" rightSection="×" onClick={() => onRemove(i)} title="Убрать">
          {f.name}
        </Button>
      ))}
    </Group>
  );
}

const sizeLabel = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

/** Фото — плиткой с просмотром, документы — списком со ссылкой на скачивание. */
export function Gallery({ files, onChanged }: { files: Attachment[]; onChanged?: () => void }) {
  const [view, setView] = useState<Attachment | null>(null);
  if (!files.length) return null;
  const images = files.filter((f) => f.isImage);
  const docs = files.filter((f) => !f.isImage);

  const archive = async (f: Attachment) => {
    if (!confirm(`Убрать «${f.fileName}»? Файл уйдёт в архив.`)) return;
    try {
      await api(`/attachments/${f.id}/archive`, { method: 'POST' });
      setView(null);
      onChanged?.();
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Ошибка' });
    }
  };

  return (
    <Stack gap={6}>
      {!!images.length && (
        <SimpleGrid cols={{ base: 3, sm: 4 }} spacing={6}>
          {images.map((f) => (
            <UnstyledButton key={f.id} onClick={() => setView(f)} aria-label={`Открыть ${f.fileName}`}>
              <Image src={fileUrl(f.id)} alt={f.fileName} h={84} radius="sm" fit="cover" loading="lazy" />
            </UnstyledButton>
          ))}
        </SimpleGrid>
      )}
      {docs.map((f) => (
        <Group key={f.id} gap={6} wrap="nowrap">
          {f.mimeType === 'application/pdf' ? <IconFileTypePdf size={18} /> : <IconFile size={18} />}
          <Anchor href={fileUrl(f.id)} target="_blank" rel="noopener" size="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {f.fileName}
          </Anchor>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {sizeLabel(f.size)}
          </Text>
          {f.canArchive && (
            <Tooltip label="Убрать в архив">
              <ActionIcon size="sm" variant="subtle" color="orange" onClick={() => archive(f)} aria-label="Убрать в архив">
                <IconArchive size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      ))}
      <Modal opened={!!view} onClose={() => setView(null)} size="xl" title={view?.fileName} zIndex={400}>
        {view && (
          <Stack>
            <Image src={fileUrl(view.id)} alt={view.fileName} fit="contain" mah="70vh" />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {view.uploadedBy ?? '—'} · {date(view.createdAt)} · {sizeLabel(view.size)}
              </Text>
              <Group gap="xs">
                <Button component="a" href={fileUrl(view.id)} target="_blank" rel="noopener" size="xs" variant="default">
                  Открыть оригинал
                </Button>
                {view.canArchive && (
                  <Button size="xs" variant="light" color="orange" leftSection={<IconArchive size={14} />} onClick={() => archive(view)}>
                    Убрать
                  </Button>
                )}
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
