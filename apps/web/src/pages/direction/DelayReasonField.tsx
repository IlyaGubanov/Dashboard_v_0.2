import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, Skeleton, Stack, Text, Textarea } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DelayReasonRow, DelayReasonsSheet, Me } from '@mvs/shared';
import { api, ApiError } from '../../api';
import { date as fmtDate } from '../../ui/format';

/** Один запрос на срез, общий для всех полей: без отдельной загрузки каждой позиции. */
export function useDelayReasons(code: string, date?: string, periodId?: number) {
  const query = useQuery({ queryKey: ['dir', code, 'delay-reasons', periodId ?? date ?? 'latest'],
    queryFn: () => api<DelayReasonsSheet>(`/directions/${code}/delay-reasons${periodId ? `?periodId=${periodId}` : date ? `?date=${date}` : ''}`) });
  const byId = useMemo(() => new Map(query.data?.rows.map(r => [r.workItemId, r])), [query.data]);
  return { ...query, byId };
}

export function DelayReason({ code, workItemId, date, periodId }: { code: string; workItemId: number; date?: string; periodId?: number }) {
  const q = useDelayReasons(code, date, periodId);
  if (q.error) return <Alert color="red" title="Причина отставания">{q.error.message}</Alert>;
  const row = q.byId.get(workItemId);
  if (!q.data) return <Skeleton h={90} />;
  if (!row) return <Text size="xs" c="dimmed">Нет отчётной точки для этой работы</Text>;
  return <DelayReasonField key={`${row.workItemId}-${row.periodId}`} code={code} row={row} />;
}

export function DelayReasonField({ code, row }: { code: string; row: DelayReasonRow }) {
  const qc = useQueryClient();
  const userId = qc.getQueryData<Me>(['me'])?.id;
  const key = userId ? `mvs:delay-draft:${userId}:${code}:${row.periodId}:${row.workItemId}` : null;
  const [draft, updateDraft] = useState<{ text: string; version: number } | null>(() => {
    if (!key) return null;
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return stored && typeof stored.text === 'string' && Number.isInteger(stored.version) && stored.version >= 0 ? stored : null;
    } catch { return null; }
  });
  const setDraft = (next: { text: string; version: number } | null) => {
    updateDraft(next);
    if (key) try { if (next) sessionStorage.setItem(key, JSON.stringify(next)); else sessionStorage.removeItem(key); } catch { /* форма продолжает работать без доступа к хранилищу */ }
  };
  const value = row.canEdit ? draft?.text ?? row.text : row.text;
  const dirty = draft != null && draft.text !== row.text;
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const save = useMutation({
    mutationFn: () => api<{ version: number }>(`/directions/${code}/delay-reasons/${row.periodId}/${row.workItemId}`, { method: 'PUT', body: { text: value, version: draft?.version ?? row.version } }),
    onSuccess: async result => {
      qc.setQueriesData<DelayReasonsSheet>({ queryKey: ['dir', code, 'delay-reasons'] }, old => old ? { rows: old.rows.map(r => r.workItemId === row.workItemId && r.periodId === row.periodId ? { ...r, text: value.trim(), version: result.version } : r) } : old);
      setDraft(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['dir', code, 'delay-reasons'] }), qc.invalidateQueries({ queryKey: ['dir', code, 'audit'] })]);
    },
  });
  const names = row.responsibles.map(u => u.fullName).join('; ');
  return <Stack gap={6} className="delay-reason" data-work-item={row.workItemId} style={{ whiteSpace: 'normal' }}>
    <Textarea label="Причина отставания от графика" aria-label={`Причина отставания от графика: ${row.name}`}
      description={names ? `Ответственные: ${names}` : 'Ответственные не назначены — назначьте их в конструкторе направлений'}
      value={value} onChange={e => setDraft({ text: e.currentTarget.value, version: draft?.version ?? row.version })}
      readOnly={!row.canEdit} disabled={save.isPending} maxLength={2000} rows={3} resize="vertical"
      placeholder="Укажите причину отставания" required={row.required} />
    {row.required && <Text size="xs" className="delay-reason-status">Обязательно при отставании</Text>}
    <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
      {row.periodDate ? `Отчётная дата: ${fmtDate(row.periodDate)}` : 'Отчётных точек пока нет'}
      {row.from && row.from !== row.periodDate ? ` · перенесено с ${fmtDate(row.from)}` : ''}
      {row.updatedBy ? ` · заполнил: ${row.updatedBy}` : ''}
      {!row.canEdit && row.periodId ? ' · только просмотр' : ''}
    </Text>
    {save.error && <Alert color="red">{save.error.message}{save.error instanceof ApiError && save.error.status === 409 && <Button mt={6} size="xs" variant="default" onClick={async () => { await qc.invalidateQueries({ queryKey: ['dir', code, 'delay-reasons'] }); setDraft(null); save.reset(); }}>Загрузить актуальную причину</Button>}</Alert>}
    {!row.canEdit && dirty && <Alert color="orange" title="Есть несохранённый черновик">Право заполнения изменилось. Выше показана сохранённая причина. Ваш черновик: {draft?.text}</Alert>}
    {dirty && <Group gap="xs" wrap="wrap">
      {row.canEdit && <Button size="xs" color="red" loading={save.isPending} disabled={row.required && !value.trim()} onClick={() => save.mutate()}>Сохранить причину</Button>}
      <Button size="xs" variant="default" disabled={save.isPending} onClick={() => { setDraft(null); save.reset(); }}>Отменить</Button>
      <Text size="xs">Черновик — не сохранён</Text>
    </Group>}
    {save.isSuccess && !dirty && <Text size="xs" c="dimmed" role="status">Причина сохранена</Text>}
  </Stack>;
}
