import { useState } from 'react';
import { Alert, Button, Checkbox, Group, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import type { SiteCardTracker, TrackerSaveInput } from '@mvs/shared';
import { api, ApiError } from '../../api';
import type { TrackerRawValue, TrackerStage } from '../../ui/TrackerValue';

type Values = Record<string, Record<string, TrackerRawValue>>;

/** Поле ввода значения этапа по его типу. */
function StageInput({ stage, value, dirty, error, onChange }: { stage: TrackerStage; value: TrackerRawValue; dirty: boolean; error?: string; onChange: (v: TrackerRawValue) => void }) {
  const styles = dirty ? { input: { background: 'var(--dirty)' } } : undefined;
  switch (stage.valueType) {
    case 'PERCENT':
      return <NumberInput size="xs" min={0} max={100} clampBehavior="strict" suffix=" %" error={error} styles={styles} value={(value as number) ?? ''} onChange={(v) => onChange(v === '' ? null : Number(v))} />;
    case 'NUMBER':
      return <NumberInput size="xs" error={error} styles={styles} value={(value as number) ?? ''} onChange={(v) => onChange(v === '' ? null : Number(v))} />;
    case 'BOOL':
      return <Checkbox checked={!!value} onChange={(e) => onChange(e.currentTarget.checked)} aria-label={stage.name} />;
    case 'DATE':
      return <TextInput size="xs" type="date" error={error} styles={styles} value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)} />;
    case 'STATUS':
      return <Select size="xs" clearable error={error} styles={styles} data={(stage.options ?? []).map((o) => ({ value: o.value, label: o.label }))} value={(value as string) ?? null} onChange={(v) => onChange(v)} />;
    default:
      return <TextInput size="xs" error={error} styles={styles} value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)} />;
  }
}

/** Ввод надстройки по объекту: таблица «строка × этап» или карточка этапов. Сохраняются только изменённые строки. */
export function TrackerEditor({ t, code, siteId, onDone }: { t: SiteCardTracker; code: string; siteId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const initial: Values = Object.fromEntries(t.rows.map((r) => [r.item.code, { ...r.values }]));
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (item: string, stage: string, val: TrackerRawValue) => setV((x) => ({ ...x, [item]: { ...x[item], [stage]: val } }));
  const dirty = (item: string, stage: string) => (v[item]?.[stage] ?? null) !== (initial[item]?.[stage] ?? null);

  const changedRows = t.rows.filter((r) => t.stages.some((s) => dirty(r.item.code, s.code)));
  const save = async () => {
    setSaving(true);
    setErrors({});
    const body: TrackerSaveInput = {
      rows: changedRows.map((r) => ({
        itemCode: r.item.code,
        values: Object.fromEntries(t.stages.filter((s) => dirty(r.item.code, s.code)).map((s) => [s.code, (v[r.item.code][s.code] ?? null) as string | number | boolean | null])),
      })),
    };
    try {
      await api(`/directions/${code}/manage/sites/${siteId}/trackers/${t.code}`, { method: 'PUT', body });
      await qc.invalidateQueries({ queryKey: ['dir', code] });
      notifications.show({ color: 'green', message: `${t.name}: сохранено строк — ${changedRows.length}` });
      onDone();
    } catch (e) {
      if (e instanceof ApiError) {
        // ошибки приходят по номеру строки в запросе — переводим в «код строки|этап»
        const mapped: Record<string, string> = {};
        for (const [k, msg] of Object.entries(e.fields)) {
          const m = k.match(/^rows\.(\d+)\.values\.(.+)$/);
          if (m) mapped[`${changedRows[Number(m[1])]?.item.code}|${m[2]}`] = msg;
        }
        setErrors(mapped);
        notifications.show({ color: 'red', message: e.message });
      }
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">
        Изменено строк: {changedRows.length}
      </Text>
      <Group>
        <Button variant="default" size="sm" onClick={onDone}>
          Отмена
        </Button>
        <Button size="sm" loading={saving} disabled={!changedRows.length} onClick={save}>
          Сохранить
        </Button>
      </Group>
    </Group>
  );

  if (t.layout === 'CARD') {
    const code0 = t.rows[0]?.item.code ?? 'main';
    return (
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {t.stages.map((s) => (
            <div key={s.code}>
              <Text size="xs" c="dimmed" mb={2}>
                {s.name}
              </Text>
              <StageInput stage={s} value={v[code0]?.[s.code]} dirty={dirty(code0, s.code)} error={errors[`${code0}|${s.code}`]} onChange={(x) => set(code0, s.code, x)} />
            </div>
          ))}
        </SimpleGrid>
        {!t.rows.length && <Alert color="gray">По объекту ещё нет строки этой надстройки.</Alert>}
        {footer}
      </Stack>
    );
  }

  return (
    <Stack>
      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Позиция</Table.Th>
              {t.stages.map((s) => (
                <Table.Th key={s.code} w={160}>
                  {s.name}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {t.rows.map((r) => (
              <Table.Tr key={r.item.code}>
                <Table.Td>
                  <Text size="sm">{r.item.name}</Text>
                  {r.item.category && (
                    <Text size="xs" c="dimmed">
                      {r.item.category}
                    </Text>
                  )}
                </Table.Td>
                {t.stages.map((s) => (
                  <Table.Td key={s.code}>
                    <StageInput stage={s} value={v[r.item.code]?.[s.code]} dirty={dirty(r.item.code, s.code)} error={errors[`${r.item.code}|${s.code}`]} onChange={(x) => set(r.item.code, s.code, x)} />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {footer}
    </Stack>
  );
}
