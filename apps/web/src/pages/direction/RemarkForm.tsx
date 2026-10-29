import { useEffect, useState } from 'react';
import { Autocomplete, Button, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REMARK_SEVERITIES, REMARK_SEVERITY_LABELS, type RemarkCard, type RemarkInput, type RemarkList } from '@mvs/shared';
import { api, ApiError, directionQueries } from '../../api';
import { AddFiles, PendingFiles, uploadMany } from '../../ui/attachments';

/** форма открывается поверх карточек (слой 200–300), списки — поверх формы */
const DROPDOWN = { zIndex: 1000 };
const blank = (siteId?: number): RemarkInput => ({ siteId: siteId ?? 0, text: '', category: '', severity: 'MEDIUM', dueDate: '', assigneeId: null, workItemId: null });

/**
 * Новое замечание или правка. При создании можно сразу приложить фото — они попадут в первое событие ленты.
 * onSaved получает id замечания.
 */
export function RemarkForm({
  code,
  list,
  opened,
  onClose,
  onSaved,
  siteId,
  edit,
}: {
  code: string;
  list: RemarkList;
  opened: boolean;
  onClose: () => void;
  onSaved?: (id: number) => void;
  siteId?: number;
  edit?: RemarkCard;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState<RemarkInput>(blank(siteId));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setErrors({});
    setFiles([]);
    setV(
      edit
        ? { siteId: edit.site.id, workItemId: edit.workItem?.id ?? null, text: edit.text, category: edit.category ?? '', severity: edit.severity, dueDate: edit.dueDate ?? '', assigneeId: edit.assignee?.id ?? null, version: edit.version }
        : blank(siteId ?? (list.sites.length === 1 ? list.sites[0].id : undefined)),
    );
  }, [opened, edit, siteId, list.sites]);

  // позиции выбранного объекта — из карточки объекта
  const { data: site } = useQuery({ ...directionQueries.site(code, v.siteId), enabled: opened && v.siteId > 0 });
  const set = (p: Partial<RemarkInput>) => setV({ ...v, ...p });

  const submit = async () => {
    setBusy(true);
    try {
      let id = edit?.id;
      if (edit) {
        await api(`/directions/${code}/remarks/${edit.id}`, { method: 'PATCH', body: v });
      } else {
        const r = await api<{ id: number; num: number; eventId: number }>(`/directions/${code}/remarks`, { method: 'POST', body: v });
        id = r.id;
        if (files.length) await uploadMany('remark_event', r.eventId, files);
        notifications.show({ color: 'green', message: `Замечание № ${r.num} выставлено` });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['dir', code] }), qc.invalidateQueries({ queryKey: ['me', 'tasks'] })]);
      onClose();
      onSaved?.(id!);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={edit ? `Замечание № ${edit.num}` : 'Новое замечание'} size="lg" zIndex={400}>
      <Stack>
        <Select
          comboboxProps={DROPDOWN}
          label="Объект"
          required
          searchable
          disabled={!!edit || !!siteId}
          data={list.sites.map((s) => ({ value: String(s.id), label: s.name }))}
          value={v.siteId ? String(v.siteId) : null}
          onChange={(x) => set({ siteId: Number(x), workItemId: null })}
          error={errors.siteId}
          nothingFoundMessage="Нет объектов"
        />
        <Select
          comboboxProps={DROPDOWN}
          label="Позиция (необязательно)"
          searchable
          clearable
          disabled={!site}
          data={(site?.items ?? []).map((i) => ({ value: String(i.id), label: i.name }))}
          value={v.workItemId ? String(v.workItemId) : null}
          onChange={(x) => set({ workItemId: x ? Number(x) : null })}
          error={errors.workItemId}
        />
        <Textarea label="Замечание" required autosize minRows={3} maxRows={10} value={v.text} onChange={(e) => set({ text: e.currentTarget.value })} error={errors.text} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Autocomplete comboboxProps={DROPDOWN} label="Категория" data={list.categories} value={v.category ?? ''} onChange={(x) => set({ category: x })} />
          <TextInput type="date" label="Срок устранения" value={v.dueDate ?? ''} onChange={(e) => set({ dueDate: e.currentTarget.value })} error={errors.dueDate} />
        </SimpleGrid>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Важность
          </Text>
          <SegmentedControl fullWidth data={REMARK_SEVERITIES.map((s) => ({ value: s, label: REMARK_SEVERITY_LABELS[s] }))} value={v.severity} onChange={(x) => set({ severity: x as RemarkInput['severity'] })} />
        </div>
        <Select
          comboboxProps={DROPDOWN}
          label="Исполнитель"
          description="кто должен устранить; пусто — ответственные по объекту"
          searchable
          clearable
          data={list.people.map((p) => ({ value: String(p.id), label: p.fullName }))}
          value={v.assigneeId ? String(v.assigneeId) : null}
          onChange={(x) => set({ assigneeId: x ? Number(x) : null })}
          error={errors.assigneeId}
        />
        {!edit && (
          <Stack gap={6}>
            <AddFiles onFiles={(f) => setFiles([...files, ...f])} />
            <PendingFiles files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
          </Stack>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={busy}>
            {edit ? 'Сохранить' : 'Выставить замечание'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
