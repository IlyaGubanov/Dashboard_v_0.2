import { Fragment, useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  ColorInput,
  Group,
  MultiSelect,
  Select,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Tabs,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  DEFAULT_APPEARANCE,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  METRIC_CATALOG,
  OVERVIEW_TILES,
  TILE_COLOR_TOKENS,
  type OverviewTileConfig,
  TRACKER_VALUE_LABELS,
  TRACKER_VALUE_TYPES,
  type DirectionDef,
  type DirectionInput,
} from '@mvs/shared';
import { api, ApiError } from '../../api';
import { DirectionIcon } from '../../ui/DirectionIcon';
import { DirectionForm } from './DirectionForm';
import { DelayReasonSettings } from './DelayReasonSettings';

const route = getRouteApi('/app/admin/directions/$code');
type Opt = { value: string; label: string; color?: string; done?: boolean };

/** Сохранение с уведомлением; ошибки по полям возвращаются вызывающему. */
function useSave(code: string) {
  const qc = useQueryClient();
  return async (path: string, method: 'PUT' | 'PATCH', body: unknown): Promise<Record<string, string> | null> => {
    try {
      await api(`/admin/directions/${code}${path}`, { method, body });
      await qc.invalidateQueries();
      notifications.show({ color: 'green', message: 'Сохранено' });
      return null;
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : 'Ошибка' });
      return e instanceof ApiError ? e.fields : {};
    }
  };
}

/** Метки → варианты списка: подпись видна людям, значение сохраняется (для новых — совпадает с подписью). */
const toOptions = (labels: string[], prev: Opt[] | null | undefined): Opt[] =>
  labels.map((l) => prev?.find((o) => o.label === l) ?? { value: l, label: l });

function move<T>(arr: T[], i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function RowTools({ i, n, onMove, onRemove, removeHint }: { i: number; n: number; onMove: (d: -1 | 1) => void; onRemove: () => void; removeHint?: string }) {
  return (
    <Group gap={2} wrap="nowrap">
      <ActionIcon variant="subtle" size="sm" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Выше">
        <IconArrowUp size={14} />
      </ActionIcon>
      <ActionIcon variant="subtle" size="sm" disabled={i === n - 1} onClick={() => onMove(1)} aria-label="Ниже">
        <IconArrowDown size={14} />
      </ActionIcon>
      <Tooltip label={removeHint ?? 'Убрать'}>
        <ActionIcon variant="subtle" size="sm" color="red" onClick={onRemove} aria-label="Убрать">
          <IconTrash size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function DirectionEditorPage() {
  const { code } = route.useParams();
  const { data: d, error } = useQuery({ queryKey: ['admin', 'direction', code], queryFn: () => api<DirectionDef>(`/admin/directions/${code}`) });
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!d) return <Skeleton h={400} />;
  return (
    <Stack className="reading-page">
      <Anchor component={Link} to="/admin/directions" size="sm">
        ← Все направления
      </Anchor>
      <Group gap="sm">
        <DirectionIcon icon={d.icon} color={d.color} size={40} />
        <div>
          <Title order={2}>{d.name}</Title>
          <Text size="sm" c="dimmed">
            {d.code} · объектов {d.counts.sites} · отчётных точек {d.counts.periods} · участников {d.counts.members}
            {' · '}
            <Anchor size="sm" renderRoot={(props) => <Link to="/d/$code" params={{ code: d.code }} {...props} />}>
              открыть направление
            </Anchor>
          </Text>
        </div>
        {!d.isActive && <Badge color="gray">выключено</Badge>}
      </Group>
      <Tabs defaultValue="main" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="main">Основное</Tabs.Tab>
          <Tabs.Tab value="delay-reasons">Причины отставания</Tabs.Tab>
          <Tabs.Tab value="statuses">Статусы · {d.statuses.length}</Tabs.Tab>
          <Tabs.Tab value="fields">Доп. поля · {d.fields.filter((f) => !f.isArchived).length}</Tabs.Tab>
          <Tabs.Tab value="trackers">Надстройки · {d.trackers.length}</Tabs.Tab>
          <Tabs.Tab value="kpis">Показатели сводки · {d.kpis.length}</Tabs.Tab>
          <Tabs.Tab value="tiles">Плитки обзора</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="main" pt="md">
          <Main d={d} />
        </Tabs.Panel>
        <Tabs.Panel value="delay-reasons" pt="md"><DelayReasonSettings code={code} /></Tabs.Panel>
        <Tabs.Panel value="statuses" pt="md">
          <Statuses d={d} />
        </Tabs.Panel>
        <Tabs.Panel value="fields" pt="md">
          <Fields d={d} />
        </Tabs.Panel>
        <Tabs.Panel value="trackers" pt="md">
          <Trackers d={d} />
        </Tabs.Panel>
        <Tabs.Panel value="kpis" pt="md">
          <Kpis d={d} />
        </Tabs.Panel>
        <Tabs.Panel value="tiles" pt="md">
          <Tiles d={d} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function Main({ d }: { d: DirectionDef }) {
  const save = useSave(d.code);
  const [v, setV] = useState<DirectionInput>({ ...d, description: d.description ?? '', moneyLabel: d.moneyLabel ?? '', factLabel: d.factLabel ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Card withBorder padding="lg">
      <Stack>
        <DirectionForm v={v} setV={setV} errors={errors} />
        <Group justify="flex-end">
          <Button onClick={async () => setErrors((await save('', 'PATCH', v)) ?? {})}>Сохранить</Button>
        </Group>
      </Stack>
    </Card>
  );
}

type StatusRow = DirectionDef['statuses'][number] & { isNew?: boolean };

function Statuses({ d }: { d: DirectionDef }) {
  const save = useSave(d.code);
  const [entity, setEntity] = useState<'WORK_ITEM' | 'SITE'>('WORK_ITEM');
  const [rows, setRows] = useState<StatusRow[]>([]);
  useEffect(() => setRows(d.statuses.filter((s) => s.entity === entity)), [d, entity]);
  const set = (i: number, p: Partial<StatusRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card withBorder padding="lg">
      <Stack>
        <Group justify="space-between">
          <SegmentedControl
            value={entity}
            onChange={(x) => setEntity(x as typeof entity)}
            data={[
              { value: 'WORK_ITEM', label: 'Статусы позиций' },
              { value: 'SITE', label: 'Статусы объектов' },
            ]}
          />
          <Text size="xs" c="dimmed" maw={520}>
            «Считается выполненным» — позиция в этом статусе засчитывается на 100 % (КС-2 подписаны, оплачено). «Не учитывать» — позиция
            выпадает из расчёта (снята с договора). Используемый статус удалить нельзя.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={860}>
        <Table verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={120}>Код</Table.Th>
              <Table.Th miw={220}>Название</Table.Th>
              <Table.Th w={150}>Цвет</Table.Th>
              {entity === 'WORK_ITEM' && <Table.Th w={110}>Выполнено</Table.Th>}
              {entity === 'WORK_ITEM' && <Table.Th w={110}>Не учитывать</Table.Th>}
              <Table.Th w={90}>Итоговый</Table.Th>
              <Table.Th w={90} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <TextInput size="xs" value={r.code} disabled={!r.isNew} onChange={(e) => set(i, { code: e.currentTarget.value })} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={r.name} onChange={(e) => set(i, { name: e.currentTarget.value })} />
                </Table.Td>
                <Table.Td>
                  <ColorInput size="xs" value={r.color ?? ''} onChange={(x) => set(i, { color: x })} />
                </Table.Td>
                {entity === 'WORK_ITEM' && (
                  <Table.Td>
                    <Checkbox checked={r.countsAsDone} onChange={(e) => set(i, { countsAsDone: e.currentTarget.checked })} />
                  </Table.Td>
                )}
                {entity === 'WORK_ITEM' && (
                  <Table.Td>
                    <Checkbox checked={r.excludeFromCalc} onChange={(e) => set(i, { excludeFromCalc: e.currentTarget.checked })} />
                  </Table.Td>
                )}
                <Table.Td>
                  <Checkbox checked={r.isFinal} onChange={(e) => set(i, { isFinal: e.currentTarget.checked })} />
                </Table.Td>
                <Table.Td>
                  <RowTools i={i} n={rows.length} onMove={(dd) => setRows(move(rows, i, dd))} onRemove={() => setRows(rows.filter((_, j) => j !== i))} removeHint={r.used ? `используется: ${r.used}` : undefined} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        </Table.ScrollContainer>
        <Group justify="space-between">
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() =>
              setRows([...rows, { entity, code: `st${rows.length + 1}`, name: '', shortName: null, color: '#9aa4b2', countsAsDone: false, excludeFromCalc: false, isFinal: false, used: 0, isNew: true }])
            }
          >
            Добавить статус
          </Button>
          <Button
            onClick={() =>
              save('/statuses', 'PUT', {
                entity,
                items: rows.map(({ code, name, shortName, color, countsAsDone, excludeFromCalc, isFinal }) => ({ code, name, shortName, color, countsAsDone, excludeFromCalc, isFinal })),
              })
            }
          >
            Сохранить статусы
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

type FieldRow = DirectionDef['fields'][number] & { isNew?: boolean };

function Fields({ d }: { d: DirectionDef }) {
  const save = useSave(d.code);
  const [entity, setEntity] = useState<'SITE' | 'WORK_ITEM'>('SITE');
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setRows(d.fields.filter((f) => f.entity === entity && !f.isArchived)), [d, entity]);
  const set = (i: number, p: Partial<FieldRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const err = (i: number, k: string) => errors[`items.${i}.${k}`];
  return (
    <Card withBorder padding="lg">
      <Stack>
        <Group justify="space-between">
          <SegmentedControl
            value={entity}
            onChange={(x) => setEntity(x as typeof entity)}
            data={[
              { value: 'SITE', label: 'Поля объекта' },
              { value: 'WORK_ITEM', label: 'Поля позиции' },
            ]}
          />
          <Text size="xs" c="dimmed" maw={520}>
            Поля появляются в паспорте объекта и в форме редактирования. Убранное поле уходит в архив: внесённые значения сохраняются.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={1000}>
          <Table verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={130}>Код</Table.Th>
                <Table.Th>Подпись</Table.Th>
                <Table.Th w={170}>Тип</Table.Th>
                <Table.Th w={90}>Ед.</Table.Th>
                <Table.Th w={150}>Группа</Table.Th>
                <Table.Th w={80}>Обязат.</Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Fragment key={i}>
                  <Table.Tr>
                    <Table.Td>
                      <TextInput size="xs" value={r.code} disabled={!r.isNew} error={err(i, 'code')} onChange={(e) => set(i, { code: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={r.label} error={err(i, 'label')} onChange={(e) => set(i, { label: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td>
                      <Select size="xs" allowDeselect={false} data={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))} value={r.type} onChange={(x) => set(i, { type: x! })} />
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={r.unit ?? ''} onChange={(e) => set(i, { unit: e.currentTarget.value || null })} />
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={r.groupName ?? ''} onChange={(e) => set(i, { groupName: e.currentTarget.value || null })} />
                    </Table.Td>
                    <Table.Td>
                      <Checkbox checked={r.required} onChange={(e) => set(i, { required: e.currentTarget.checked })} />
                    </Table.Td>
                    <Table.Td>
                      <RowTools i={i} n={rows.length} onMove={(dd) => setRows(move(rows, i, dd))} onRemove={() => setRows(rows.filter((_, j) => j !== i))} removeHint="В архив (значения сохранятся)" />
                    </Table.Td>
                  </Table.Tr>
                  {(r.type === 'SELECT' || r.type === 'MULTISELECT') && (
                    <Table.Tr>
                      <Table.Td />
                      <Table.Td colSpan={6}>
                        <TagsInput
                          size="xs"
                          label="Варианты (Enter после каждого)"
                          error={err(i, 'options')}
                          value={(r.options ?? []).map((o) => o.label)}
                          onChange={(labels) => set(i, { options: toOptions(labels, r.options) })}
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group justify="space-between">
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() => setRows([...rows, { entity, code: `field${rows.length + 1}`, label: '', type: 'TEXT', options: null, unit: null, required: false, groupName: null, hint: null, showInList: false, isArchived: false, isNew: true }])}
          >
            Добавить поле
          </Button>
          <Button
            onClick={async () =>
              setErrors(
                (await save('/fields', 'PUT', {
                  entity,
                  items: rows.map(({ code, label, type, options, unit, required, groupName, hint, showInList }) => ({ code, label, type, options, unit, required, groupName, hint, showInList })),
                })) ?? {},
              )
            }
          >
            Сохранить поля
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

type TrackerRow = DirectionDef['trackers'][number];

function Trackers({ d }: { d: DirectionDef }) {
  const [open, setOpen] = useState<string | null>(d.trackers[0]?.code ?? null);
  const [creating, setCreating] = useState(false);
  const blank: TrackerRow = { code: '', name: '', layout: 'MATRIX', description: null, isActive: true, rows: 0, stages: [{ code: 'done', name: 'Выполнено', valueType: 'PERCENT', options: null, inProgress: true }], items: [] };
  const t = creating ? blank : d.trackers.find((x) => x.code === open);
  return (
    <Stack>
      <Group>
        <SegmentedControl
          value={creating ? '__new' : (open ?? '')}
          onChange={(x) => (x === '__new' ? setCreating(true) : (setCreating(false), setOpen(x)))}
          data={[...d.trackers.map((x) => ({ value: x.code, label: x.name })), { value: '__new', label: '+ Новая надстройка' }]}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Надстройка — таблица «строки × этапы» на каждом объекте: закупки (материалы × оплата/поставка/монтаж), испытания (системы × статус),
        согласования, документация. «Карточка» — одна строка на объект с полями-этапами (как МГЭ).
      </Text>
      {t && <TrackerForm key={creating ? '__new' : t.code} d={d} t={t} isNew={creating} onCreated={(c) => (setCreating(false), setOpen(c))} />}
    </Stack>
  );
}

function TrackerForm({ d, t, isNew, onCreated }: { d: DirectionDef; t: TrackerRow; isNew: boolean; onCreated: (code: string) => void }) {
  const save = useSave(d.code);
  const [v, setV] = useState(t);
  const [code, setCode] = useState(t.code);
  const [bulk, setBulk] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setStage = (i: number, p: Partial<TrackerRow['stages'][number]>) => setV({ ...v, stages: v.stages.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setItem = (i: number, p: Partial<TrackerRow['items'][number]>) => setV({ ...v, items: v.items.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const items = v.items.filter((i) => !i.isArchived);

  const addBulk = () => {
    // по строке на позицию: «Название» или «Название; категория; ед.»
    const start = v.items.length;
    const added = bulk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l, k) => {
        const [name, category, unit] = l.split(';').map((x) => x.trim());
        return { code: `r${start + k + 1}`, name, category: category || null, unit: unit || null, isArchived: false };
      });
    setV({ ...v, items: [...v.items, ...added] });
    setBulk('');
  };

  const submit = async () => {
    const res = await save(`/trackers/${code}`, 'PUT', {
      name: v.name,
      layout: v.layout,
      description: v.description,
      isActive: v.isActive,
      stages: v.stages.map(({ code: c, name, valueType, options, inProgress }) => ({ code: c, name, valueType, options, inProgress })),
      items: items.map(({ code: c, name, category, unit }) => ({ code: c, name, category, unit })),
    });
    setErrors(res ?? {});
    if (!res && isNew) onCreated(code);
  };

  return (
    <Card withBorder padding="lg">
      <Stack>
        <Group grow align="flex-start">
          {isNew && <TextInput label="Код" required description="латиницей" value={code} onChange={(e) => setCode(e.currentTarget.value)} />}
          <TextInput label="Название" required error={errors.name} value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
          <Select
            label="Вид"
            allowDeselect={false}
            data={[
              { value: 'MATRIX', label: 'Таблица: строки × этапы' },
              { value: 'CARD', label: 'Карточка: одна строка' },
            ]}
            value={v.layout}
            onChange={(x) => setV({ ...v, layout: x as TrackerRow['layout'] })}
          />
        </Group>
        <Checkbox label="Включена" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.currentTarget.checked })} />

        <Text fw={600}>Этапы (колонки)</Text>
        {errors.stages && <Alert color="red">{errors.stages}</Alert>}
        {v.stages.map((s, i) => (
          <Stack key={i} gap={4}>
            <Group wrap="nowrap" align="flex-start">
              <TextInput w={120} size="xs" aria-label="код" placeholder="код" value={s.code} onChange={(e) => setStage(i, { code: e.currentTarget.value })} error={errors[`stages.${i}.code`]} />
              <TextInput style={{ flex: 1 }} size="xs" aria-label="Название" placeholder="Название" value={s.name} onChange={(e) => setStage(i, { name: e.currentTarget.value })} />
              <Select w={200} size="xs" allowDeselect={false} data={TRACKER_VALUE_TYPES.map((x) => ({ value: x, label: TRACKER_VALUE_LABELS[x] }))} value={s.valueType} onChange={(x) => setStage(i, { valueType: x! })} />
              <Checkbox size="xs" mt={6} label="в готовности" checked={s.inProgress} onChange={(e) => setStage(i, { inProgress: e.currentTarget.checked })} />
              <RowTools i={i} n={v.stages.length} onMove={(dd) => setV({ ...v, stages: move(v.stages, i, dd) })} onRemove={() => setV({ ...v, stages: v.stages.filter((_, j) => j !== i) })} removeHint="Удалить (нельзя, если есть значения)" />
            </Group>
            {s.valueType === 'STATUS' && (
              <Group ml={136} align="flex-end" wrap="nowrap">
                <TagsInput style={{ flex: 1 }} size="xs" label="Статусы" error={errors[`stages.${i}.options`]} value={(s.options ?? []).map((o) => o.label)} onChange={(labels) => setStage(i, { options: toOptions(labels, s.options) })} />
                <MultiSelect
                  w={260}
                  size="xs"
                  label="Какие считаются завершёнными"
                  data={(s.options ?? []).map((o) => o.label)}
                  value={(s.options ?? []).filter((o) => o.done).map((o) => o.label)}
                  onChange={(done) => setStage(i, { options: (s.options ?? []).map((o) => ({ ...o, done: done.includes(o.label) })) })}
                />
              </Group>
            )}
          </Stack>
        ))}
        <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} style={{ alignSelf: 'flex-start' }} onClick={() => setV({ ...v, stages: [...v.stages, { code: `stage${v.stages.length + 1}`, name: '', valueType: 'PERCENT', options: null, inProgress: true }] })}>
          Добавить этап
        </Button>

        <Text fw={600}>Строки · {items.length}</Text>
        {errors.items && <Alert color="red">{errors.items}</Alert>}
        <Table.ScrollContainer minWidth={700} maxHeight={360} scrollAreaProps={{ type: 'auto' }}>
          <Table verticalSpacing={2}>
            <Table.Tbody>
              {v.items.map((it, i) =>
                it.isArchived ? null : (
                  <Table.Tr key={i}>
                    <Table.Td w={110}>
                      <TextInput size="xs" value={it.code} onChange={(e) => setItem(i, { code: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={it.name} onChange={(e) => setItem(i, { name: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td w={200}>
                      <TextInput size="xs" aria-label="категория" placeholder="категория" value={it.category ?? ''} onChange={(e) => setItem(i, { category: e.currentTarget.value || null })} />
                    </Table.Td>
                    <Table.Td w={90}>
                      <TextInput size="xs" aria-label="ед." placeholder="ед." value={it.unit ?? ''} onChange={(e) => setItem(i, { unit: e.currentTarget.value || null })} />
                    </Table.Td>
                    <Table.Td w={90}>
                      <RowTools i={i} n={v.items.length} onMove={(dd) => setV({ ...v, items: move(v.items, i, dd) })} onRemove={() => setItem(i, { isArchived: true })} removeHint="В архив (значения сохранятся)" />
                    </Table.Td>
                  </Table.Tr>
                ),
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group align="flex-end">
          <Textarea style={{ flex: 1 }} size="xs" autosize minRows={2} label="Добавить списком: по строке на позицию, «Название; категория; ед.»" value={bulk} onChange={(e) => setBulk(e.currentTarget.value)} />
          <Button variant="light" size="xs" disabled={!bulk.trim()} onClick={addBulk}>
            Добавить
          </Button>
        </Group>
        <Group justify="flex-end">
          <Button onClick={submit}>{isNew ? 'Создать надстройку' : 'Сохранить надстройку'}</Button>
        </Group>
      </Stack>
    </Card>
  );
}

/** Цвет плитки: как у всех, смысловой (подстраивается под тему) или свой код. */
const TILE_COLOR_OPTIONS = [
  { value: '', label: 'Как у всех' },
  ...Object.entries(TILE_COLOR_TOKENS).map(([value, label]) => ({ value, label })),
  { value: 'custom', label: 'Свой цвет…' },
];
/** Быстрый выбор своего кода цвета: смысловые цвета оформления (светлая тема). */
const TILE_SWATCHES = [DEFAULT_APPEARANCE.light.primary, DEFAULT_APPEARANCE.light.good, DEFAULT_APPEARANCE.light.warning, DEFAULT_APPEARANCE.light.critical, DEFAULT_APPEARANCE.light.series3];

/** Плитки вкладки «Обзор»: какие показывать, порядок, своя подпись и цвет. Вид и размеры плиток — «Оформление». */
function Tiles({ d }: { d: DirectionDef }) {
  const save = useSave(d.code);
  const all = [...OVERVIEW_TILES.map((t) => ({ key: t.key as string, name: t.label })), ...d.kpis.map((k, i) => ({ key: `kpi:${i}`, name: `Показатель сводки: ${k.label}` }))];
  const name = (key: string) => all.find((t) => t.key === key)?.name ?? key;
  // сохранённый порядок, затем плитки, которых в настройке ещё нет
  const [rows, setRows] = useState<OverviewTileConfig[]>(() => [
    ...d.overviewTiles.filter((c) => all.some((t) => t.key === c.key)),
    ...all.filter((t) => !d.overviewTiles.some((c) => c.key === t.key)).map((t) => ({ key: t.key, hidden: false, label: '', color: null })),
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const upd = (i: number, p: Partial<OverviewTileConfig>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card withBorder padding="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Плитки справа от готовности на вкладке «Обзор» направления. Снимите галочку, чтобы скрыть плитку; стрелки меняют порядок. Пустая подпись —
          стандартная. Цвет красит число и полосу (или заливку) плитки; смысловые цвета сами меняются в тёмной теме. Вид плиток, размеры и общие цвета —{' '}
          <Anchor component={Link} to="/admin/appearance" size="sm">
            «Оформление»
          </Anchor>
          . Некоторые плитки появляются только при данных: отставание — при графике, люди, техника и деньги — если их вносят.
        </Text>
        {rows.map((r, i) => (
          <Card key={r.key} withBorder padding="sm" opacity={r.hidden ? 0.6 : 1}>
            <Group align="flex-end" wrap="wrap" gap="sm">
              <Checkbox
                label={name(r.key)}
                checked={!r.hidden}
                onChange={(e) => upd(i, { hidden: !e.currentTarget.checked })}
                style={{ flex: '1 1 220px' }}
                styles={{ label: { fontWeight: 600 } }}
              />
              <TextInput
                w={220}
                label="Своя подпись"
                placeholder="стандартная"
                value={r.label}
                error={errors[`${i}.label`]}
                onChange={(e) => upd(i, { label: e.currentTarget.value })}
              />
              <Select
                w={190}
                label="Цвет"
                allowDeselect={false}
                data={TILE_COLOR_OPTIONS}
                value={r.color == null ? '' : r.color in TILE_COLOR_TOKENS ? r.color : 'custom'}
                onChange={(x) => upd(i, { color: x === 'custom' ? DEFAULT_APPEARANCE.light.critical : x || null })}
                error={r.color != null && !(r.color in TILE_COLOR_TOKENS) ? undefined : errors[`${i}.color`]}
              />
              {r.color != null && !(r.color in TILE_COLOR_TOKENS) && (
                <ColorInput
                  w={150}
                  label="Код цвета"
                  description="одинаковый в обеих темах"
                  format="hex"
                  swatches={TILE_SWATCHES}
                  value={r.color}
                  error={errors[`${i}.color`]}
                  onChange={(x) => upd(i, { color: x })}
                />
              )}
              <Group gap={2} wrap="nowrap" pb={6}>
                <ActionIcon variant="subtle" size="sm" disabled={i === 0} onClick={() => setRows(move(rows, i, -1))} aria-label="Выше">
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" size="sm" disabled={i === rows.length - 1} onClick={() => setRows(move(rows, i, 1))} aria-label="Ниже">
                  <IconArrowDown size={14} />
                </ActionIcon>
              </Group>
            </Group>
          </Card>
        ))}
        <Group justify="flex-end">
          <Button onClick={async () => setErrors((await save('/tiles', 'PUT', rows)) ?? {})}>Сохранить плитки</Button>
        </Group>
      </Stack>
    </Card>
  );
}

function Kpis({ d }: { d: DirectionDef }) {
  const save = useSave(d.code);
  const [rows, setRows] = useState(d.kpis);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const statusOpts = d.statuses.map((s) => ({ value: s.code, label: s.name }));
  return (
    <Card withBorder padding="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          До 6 показателей под готовностью в карточке направления в сводке. Метрики считаются по данным направления; параметры — из его справочников.
        </Text>
        {rows.map((k, i) => {
          const spec = METRIC_CATALOG.find((m) => m.key === k.metric);
          const setP = (name: string, val: string | string[] | null) => setRows(rows.map((r, j) => (j === i ? { ...r, params: { ...r.params, [name]: val ?? '' } } : r)));
          return (
            <Card key={i} withBorder padding="sm">
              <Group align="flex-end" wrap="wrap">
                <Select
                  w={360}
                  label="Метрика"
                  allowDeselect={false}
                  data={METRIC_CATALOG.map((m) => ({ value: m.key, label: m.title }))}
                  value={k.metric}
                  onChange={(x) => setRows(rows.map((r, j) => (j === i ? { metric: x!, label: r.label || METRIC_CATALOG.find((m) => m.key === x)!.title, params: {} } : r)))}
                />
                <TextInput style={{ flex: 1 }} miw={200} label="Подпись в сводке" value={k.label} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, label: e.currentTarget.value } : r)))} />
                <RowTools i={i} n={rows.length} onMove={(dd) => setRows(move(rows, i, dd))} onRemove={() => setRows(rows.filter((_, j) => j !== i))} />
              </Group>
              {spec?.params.map((p) => {
                const val = k.params?.[p.name];
                const err = errors[`${i}.params.${p.name}`];
                switch (p.kind) {
                  case 'statusCodes':
                    return <MultiSelect key={p.name} mt="xs" label={p.label} error={err} data={statusOpts} value={(val as string[]) ?? []} onChange={(x) => setP(p.name, x)} />;
                  case 'texts':
                    return <TagsInput key={p.name} mt="xs" label={p.label} error={err} value={(val as string[]) ?? []} onChange={(x) => setP(p.name, x)} />;
                  case 'unit':
                    return <Select key={p.name} mt="xs" label={p.label} error={err} searchable data={d.units} value={(val as string) ?? null} onChange={(x) => setP(p.name, x)} />;
                  case 'tracker':
                    return <Select key={p.name} mt="xs" label={p.label} error={err} data={d.trackers.map((t) => ({ value: t.code, label: t.name }))} value={(val as string) ?? null} onChange={(x) => setP(p.name, x)} />;
                  case 'stage': {
                    const tr = d.trackers.find((t) => t.code === k.params?.tracker);
                    return <Select key={p.name} mt="xs" label={p.label} error={err} data={(tr?.stages ?? []).map((s) => ({ value: s.code, label: s.name }))} value={(val as string) ?? null} onChange={(x) => setP(p.name, x)} />;
                  }
                }
              })}
            </Card>
          );
        })}
        <Group justify="space-between">
          <Button variant="light" leftSection={<IconPlus size={16} />} disabled={rows.length >= 6} onClick={() => setRows([...rows, { metric: 'overdueItems', label: 'Просрочено позиций', params: {} }])}>
            Добавить показатель
          </Button>
          <Button onClick={async () => setErrors((await save('/kpis', 'PUT', rows)) ?? {})}>Сохранить показатели</Button>
        </Group>
      </Stack>
    </Card>
  );
}
