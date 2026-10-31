import { useEffect, useState } from 'react';
import { CKKB_GROUP_LABELS, ckkbTypeLabel } from '@mvs/shared';
import { Alert, Anchor, Badge, Box, Button, Drawer, Group, SimpleGrid, Skeleton, Stack, Text, Textarea, Timeline } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconEdit, IconMessage, IconPencil, IconPlus } from '@tabler/icons-react';
import {
  REMARK_ACTION_LABELS,
  REMARK_STATUS_LABELS,
  REMARK_TEXT_REQUIRED,
  type RemarkAction,
  type RemarkCard,
  type RemarkEvent,
} from '@mvs/shared';
import { api, ApiError, directionQueries } from '../../api';
import { AddFiles, Gallery, PendingFiles, uploadMany } from '../../ui/attachments';
import { RemarkStatusBadge, SeverityLabel } from '../../ui/RemarkBadges';
import { date } from '../../ui/format';
import { RemarkForm } from './RemarkForm';

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Порядок и вид кнопок действий: главное действие — заливкой. */
const ACTION_VIEW: Record<RemarkAction, { variant: 'filled' | 'light' | 'default'; color?: string }> = {
  start: { variant: 'light' },
  resolve: { variant: 'filled', color: 'teal' },
  verify: { variant: 'filled', color: 'teal' },
  return: { variant: 'light', color: 'orange' },
  reject: { variant: 'default' },
  reopen: { variant: 'light', color: 'orange' },
  comment: { variant: 'default' },
};

export function RemarkDrawer({ code, remarkId, onClose, onOpenSite }: { code: string; remarkId?: number; onClose: () => void; onOpenSite: (id: number) => void }) {
  const { data, error, isLoading } = useQuery({ ...directionQueries.remark(code, remarkId ?? 0), enabled: !!remarkId });
  return (
    <Drawer
      opened={!!remarkId}
      onClose={onClose}
      position="right"
      size="min(640px, 100%)"
      zIndex={300}
      title={data ? <Text fw={700}>Замечание № {data.num}</Text> : 'Замечание'}
      styles={{ body: { overflowX: 'hidden' } }}
    >
      {error && <Alert color="red">{(error as Error).message}</Alert>}
      {isLoading && <Skeleton h={300} />}
      {data && <Card c={data} code={code} onOpenSite={onOpenSite} />}
    </Drawer>
  );
}

function Card({ c, code, onOpenSite }: { c: RemarkCard; code: string; onOpenSite: (id: number) => void }) {
  const qc = useQueryClient();
  const { data: list } = useQuery(directionQueries.remarks(code));
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<RemarkAction | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['dir', code] }), qc.invalidateQueries({ queryKey: ['me', 'tasks'] })]);

  return (
    <Stack>
      <Box p="md" style={{ background: 'var(--surface-muted)', borderRadius: 8 }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <RemarkStatusBadge status={c.status} full />
          {c.isExample && (
            <Badge size="xs" variant="outline" color="gray">
              демо
            </Badge>
          )}
        </Group>
        <Text mt="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {c.text}
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 3 }} mt="sm" spacing="xs">
          <Kv k="Объект" v={<Anchor size="sm" onClick={() => onOpenSite(c.site.id)}>{c.site.name}</Anchor>} />
          {c.workItem && <Kv k="Позиция" v={c.workItem.name} />}
          <Kv k="Важность" v={<SeverityLabel severity={c.severity} />} />
          <Kv k="Категория" v={c.category ?? '—'} />
          {c.violationGroup && <Kv k="Группа ЦККБ" v={CKKB_GROUP_LABELS[c.violationGroup]} />}
          {!c.violationType && c.typeName && <Kv k="Тип нарушения" v={c.typeName} />}
          {c.violationType && <Kv k="Тип нарушения" v={ckkbTypeLabel(c.violationType)} />}
          <Kv k="Источник" v={c.sourceName || 'Не указан'} />
          {c.sourceRef && <Kv k="Документ" v={c.sourceRef} />}
          <Kv k="Выявлено" v={c.detectedOn ? date(c.detectedOn) : 'Дата не указана'} />
          {c.location && <Kv k="Место / зона" v={c.location} />}
          <Kv k="Ответственный" v={c.responsible?.fullName ?? 'Не назначен'} />
          <Kv
            k="Срок"
            v={
              <Text size="sm" fw={c.overdue ? 700 : 400} c={c.overdue ? 'var(--status-critical)' : undefined}>
                {date(c.dueDate)}
                {c.overdue ? ' · просрочено' : ''}
              </Text>
            }
          />
          <Kv k="Исполнитель" v={c.assignee?.fullName ?? 'ответственные по объекту'} />
          <Kv k="Выставил" v={`${c.author?.fullName ?? '—'}, ${date(c.createdAt)}`} />
          {c.resolvedBy && <Kv k={c.status === 'REJECTED' ? 'Снял' : 'Принял'} v={`${c.resolvedBy}, ${date(c.resolvedAt)}`} />}
        </SimpleGrid>
        {c.canEdit && (
          <Button mt="sm" size="xs" variant="subtle" leftSection={<IconEdit size={14} />} onClick={() => setEditing(true)}>
            Изменить текст, срок, исполнителя
          </Button>
        )}
      </Box>

      {c.actions.length > 0 && !action && (
        <Group gap="xs">
          {c.actions.map((a) => (
            <Button key={a} size="sm" variant={ACTION_VIEW[a].variant} color={ACTION_VIEW[a].color} leftSection={a === 'comment' ? <IconMessage size={16} /> : undefined} onClick={() => setAction(a)}>
              {REMARK_ACTION_LABELS[a]}
            </Button>
          ))}
        </Group>
      )}
      {action && <ActionForm c={c} code={code} action={action} onDone={() => (setAction(null), refresh())} onCancel={() => setAction(null)} />}

      <Text fw={600}>Ход работы</Text>
      <Timeline bulletSize={22} lineWidth={2} active={c.events.length - 1}>
        {c.events.map((e) => (
          <Timeline.Item key={e.id} bullet={e.kind === 'COMMENT' ? <IconMessage size={12} /> : e.kind === 'EDIT' ? <IconPencil size={12} /> : <IconPlus size={12} />} title={<EventTitle e={e} />}>
            <Text size="xs" c="dimmed">
              {e.author ?? '—'} · {when(e.createdAt)}
            </Text>
            {e.text && (
              <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                {e.text}
              </Text>
            )}
            {!!e.files.length && (
              <Box mt={6}>
                <Gallery files={e.files} onChanged={refresh} />
              </Box>
            )}
            {e.canAttach && <AttachLater eventId={e.id} onDone={refresh} />}
          </Timeline.Item>
        ))}
      </Timeline>

      {list && <RemarkForm code={code} list={list} opened={editing} onClose={() => setEditing(false)} edit={c} />}
    </Stack>
  );
}

function EventTitle({ e }: { e: RemarkEvent }) {
  if (e.kind === 'CREATE') return <Text size="sm" fw={600}>Выставлено</Text>;
  if (e.kind === 'COMMENT') return <Text size="sm" fw={600}>Комментарий</Text>;
  if (e.kind === 'EDIT') return <Text size="sm" fw={600}>Изменено</Text>;
  return (
    <Group gap={6}>
      <Text size="sm" fw={600}>
        {e.fromStatus ? REMARK_STATUS_LABELS[e.fromStatus] : ''} →
      </Text>
      {e.toStatus && <RemarkStatusBadge status={e.toStatus} full />}
    </Group>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed">
        {k}
      </Text>
      {typeof v === 'string' ? (
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          {v}
        </Text>
      ) : (
        v
      )}
    </div>
  );
}

/** Действие с комментарием и фото («Устранено» + фото результата). */
function ActionForm({ c, code, action, onDone, onCancel }: { c: RemarkCard; code: string; action: RemarkAction; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const required = REMARK_TEXT_REQUIRED.includes(action);
  useEffect(() => setErr(undefined), [text]);

  const submit = async () => {
    if (required && !text.trim()) return setErr('Напишите комментарий');
    setBusy(true);
    try {
      const r = await api<{ eventId: number }>(`/directions/${code}/remarks/${c.id}/actions`, { method: 'POST', body: { action, text: text.trim() || undefined, fromStatus: c.status } });
      if (files.length) await uploadMany('remark_event', r.eventId, files);
      notifications.show({ color: 'green', message: action === 'comment' ? 'Комментарий добавлен' : `Замечание № ${c.num}: ${REMARK_ACTION_LABELS[action].toLowerCase()}` });
      onDone();
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : 'Ошибка' });
      if (e instanceof ApiError && e.status === 409) onDone();
    } finally {
      setBusy(false);
    }
  };

  const hint: Partial<Record<RemarkAction, string>> = {
    resolve: 'Опишите, что сделано, и приложите фото — проверяющему будет проще принять',
    return: 'Что осталось исправить',
    reject: 'Почему замечание снимается',
    reopen: 'Почему замечание открывается снова',
  };
  return (
    <Box p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
      <Stack gap="xs">
        <Text fw={600}>{REMARK_ACTION_LABELS[action]}</Text>
        <Textarea autosize minRows={2} placeholder={hint[action] ?? 'Комментарий'} required={required} value={text} onChange={(e) => setText(e.currentTarget.value)} error={err} data-autofocus />
        <AddFiles onFiles={(f) => setFiles([...files, ...f])} compact />
        <PendingFiles files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="xs" onClick={onCancel}>
            Отмена
          </Button>
          <Button size="xs" color={ACTION_VIEW[action].color} loading={busy} onClick={submit}>
            {REMARK_ACTION_LABELS[action]}
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}

/** Автор события может дослать фото в течение суток. */
function AttachLater({ eventId, onDone }: { eventId: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Box mt={6}>
      <AddFiles
        compact
        busy={busy}
        onFiles={async (files) => {
          setBusy(true);
          await uploadMany('remark_event', eventId, files);
          setBusy(false);
          onDone();
        }}
      />
    </Box>
  );
}
