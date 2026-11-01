/**
 * Должности подразделений: таблица правки в карточке подразделения, вкладка «Должности» по всему срезу
 * и загрузка таблицы из Excel (как лист «По должностям»: № / Должность / Количество).
 */
import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Checkbox, Collapse, Group, Menu, Modal, NumberInput, Pagination, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArchive, IconClipboardText, IconDots, IconDownload, IconEdit, IconPlus, IconRestore, IconSearch, IconTableImport, IconTrash } from '@tabler/icons-react';
import { parseStaffingTable, staffingActivePositions, staffingApplyTable, staffingDuplicatePosition, staffingGroupOf, staffingGroups, staffingLinkPositions, staffingMatchRow, staffingMergeGrades, staffingMergePositions, staffingPeriodWriteSchema, staffingPositionSchema, staffingPositionTotals, staffingSetPositions, staffingTitleBase, staffingTitleKey, staffingTotalsDiffer, type StaffingPeriod, type StaffingPeriodData, type StaffingPosition, type StaffingRow } from '@mvs/shared';
import { download } from './download';

const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const num = (value: string | number) => value === '' ? null : Number(value);
const need = (p: Pick<StaffingPosition, 'planned' | 'actual'>) => p.planned == null || p.actual == null ? null : Math.max(0, Math.round((p.planned - p.actual) * 100) / 100);
const byTitle = (a: StaffingPosition, b: StaffingPosition) => a.title.localeCompare(b.title, 'ru');
const message = (e: unknown) => e instanceof Error ? e.message : 'Не удалось сохранить';
const uuid = () => crypto.randomUUID();
const NeedCell = ({ value }: { value: number | null }) => value == null ? <>—</> : value > 0 ? <Text span size="sm" fw={650} c="var(--status-warning)">△ {n(value)}</Text> : <>0</>;

/** Общий список названий для подсказки при вводе: одна должность в разных подразделениях пишется одинаково. */
export function TitleOptions({ period }: { period: Pick<StaffingPeriodData, 'positions'> }) {
  const titles = useMemo(() => [...new Set((period.positions ?? []).map(p => p.title))].sort((a, b) => a.localeCompare(b, 'ru')), [period.positions]);
  return <datalist id="staffing-titles">{titles.map(t => <option key={t} value={t} />)}</datalist>;
}

/** Сравнение итога подразделения с суммой должностей и кнопка «Подставить сумму». */
export function TotalsHint({ row, positions, canEdit, onApply }: { row: Pick<StaffingRow, 'planned' | 'actual'>; positions: StaffingPosition[]; canEdit: boolean; onApply: (t: { planned: number | null; actual: number | null }) => void }) {
  const t = staffingPositionTotals(positions);
  if (!t.count) return null;
  if (!staffingTotalsDiffer(row, t)) return <Text size="xs" c="dimmed">✓ Штат и факт подразделения совпадают с суммой должностей</Text>;
  return <Group gap="xs" wrap="wrap"><Text size="xs" c="var(--status-warning)">△ По должностям: штат {n(t.planned)}, факт {n(t.actual)}. В подразделении: штат {n(row.planned)}, факт {n(row.actual)}.</Text>{canEdit && <Button size="compact-xs" variant="default" onClick={() => onApply({ planned: t.planned ?? row.planned, actual: t.actual ?? row.actual })}>Подставить сумму</Button>}</Group>;
}

/** Таблица должностей внутри карточки подразделения. Сохраняется вместе с карточкой. */
export function PositionsEditor({ positions, saved, target, canEdit, errors, onChange }: { positions: StaffingPosition[]; saved: Set<string>; target: { rowId: string; group: string }; canEdit: boolean; errors: Record<string, string>; onChange: (next: StaffingPosition[]) => void }) {
  const [q, setQ] = useState('');
  const [archive, setArchive] = useState(false);
  const [paste, setPaste] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const archived = positions.filter(p => p.isArchived).length;
  const key = staffingTitleKey(q);
  const shown = positions.filter(p => p.isArchived === archive && (!key || staffingTitleKey(p.title).includes(key)));
  const totals = staffingPositionTotals(positions);
  const set = (id: string, patch: Partial<StaffingPosition>) => onChange(positions.map(p => p.id === id ? { ...p, ...patch } : p));
  const add = () => { const id = uuid(); setQ(''); setArchive(false); setFocus(id); onChange([{ id, group: target.group, rowId: target.rowId, title: '', planned: null, actual: null, isArchived: false }, ...positions]); };
  return <Stack gap="xs">
    <Group gap="xs" className="staffing-controls">
      {positions.length > 8 && <TextInput aria-label="Поиск должности" placeholder="Поиск должности" leftSection={<IconSearch size={15} />} value={q} onChange={e => setQ(e.currentTarget.value)} style={{ flex: '1 1 180px' }} />}
      {canEdit && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={add}>Добавить должность</Button>}
      {canEdit && <Button size="xs" variant="default" leftSection={<IconClipboardText size={14} />} onClick={() => setPaste(v => !v)}>Вставить из Excel</Button>}
      {archived > 0 && <Switch size="xs" label={`Архив (${archived})`} checked={archive} onChange={e => setArchive(e.currentTarget.checked)} />}
    </Group>
    <Collapse in={paste}><PasteBox onCancel={() => setPaste(false)} onTable={incoming => { const merged = staffingMergePositions(positions, incoming, target, uuid); onChange(merged.positions); return `Добавлено должностей: ${merged.added}, обновлено: ${merged.updated}. Сохраните карточку.`; }} /></Collapse>
    {shown.length > 0 && <Table.ScrollContainer minWidth={440} mah={420}><Table verticalSpacing={4} stickyHeader className="staffing-editor">
      <Table.Thead><Table.Tr><Table.Th>Должность</Table.Th><Table.Th w={78} ta="right">План, ед.</Table.Th><Table.Th w={78} ta="right">Факт, чел.</Table.Th><Table.Th w={60} ta="right">Нужно</Table.Th>{canEdit && <Table.Th w={38} />}</Table.Tr></Table.Thead>
      <Table.Tbody>{shown.map(p => <Table.Tr key={p.id}>
        <Table.Td><TextInput size="xs" aria-label="Название должности" list="staffing-titles" autoFocus={p.id === focus} value={p.title} onChange={e => set(p.id, { title: e.currentTarget.value })} disabled={!canEdit || p.isArchived} error={errors[p.id]} /></Table.Td>
        <Table.Td><NumberInput size="xs" hideControls aria-label={`План: ${p.title}`} value={p.planned ?? ''} onChange={v => set(p.id, { planned: num(v) })} min={0} allowNegative={false} decimalScale={2} disabled={!canEdit || p.isArchived} /></Table.Td>
        <Table.Td><NumberInput size="xs" hideControls aria-label={`Факт: ${p.title}`} value={p.actual ?? ''} onChange={v => set(p.id, { actual: num(v) })} min={0} allowNegative={false} allowDecimal={false} disabled={!canEdit || p.isArchived} /></Table.Td>
        <Table.Td ta="right"><NeedCell value={need(p)} /></Table.Td>
        {canEdit && <Table.Td>{!saved.has(p.id) ? <Tooltip label="Убрать новую строку"><ActionIcon variant="subtle" color="gray" aria-label={`Убрать: ${p.title}`} onClick={() => onChange(positions.filter(x => x.id !== p.id))}><IconTrash size={15} /></ActionIcon></Tooltip>
          : p.isArchived ? <Tooltip label="Восстановить"><ActionIcon variant="subtle" color="gray" aria-label={`Восстановить: ${p.title}`} onClick={() => set(p.id, { isArchived: false })}><IconRestore size={15} /></ActionIcon></Tooltip>
            : <Tooltip label="В архив"><ActionIcon variant="subtle" color="gray" aria-label={`В архив: ${p.title}`} onClick={() => set(p.id, { isArchived: true })}><IconArchive size={15} /></ActionIcon></Tooltip>}</Table.Td>}
      </Table.Tr>)}</Table.Tbody>
      {!archive && <Table.Tfoot><Table.Tr><Table.Td fw={600}>Итого: {totals.count}</Table.Td><Table.Td ta="right" fw={600}>{n(totals.planned)}</Table.Td><Table.Td ta="right" fw={600}>{n(totals.actual)}</Table.Td><Table.Td ta="right" fw={600}>{n(totals.need)}</Table.Td>{canEdit && <Table.Td />}</Table.Tr></Table.Tfoot>}
    </Table></Table.ScrollContainer>}
    {!shown.length && <Text size="sm" c="dimmed" py="sm" ta="center">{q ? 'Должности не найдены' : canEdit ? 'Должностей пока нет. Добавьте вручную или вставьте список из Excel.' : 'Должности не указаны'}</Text>}
  </Stack>;
}

/** Вставка списка одного подразделения из Excel: «Должность / Количество» или «№ / Должность / План / Факт». */
function PasteBox({ onTable, onCancel }: { onTable: (incoming: { title: string; planned: number | null; actual: number | null }[]) => string; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [quantity, setQuantity] = useState<'actual' | 'planned'>('actual');
  const [result, setResult] = useState<{ error?: string; done?: string; problems: string[] }>({ problems: [] });
  function apply() {
    const table = parseStaffingTable(text, quantity);
    if (table.blocks.filter(b => b.name).length > 1) return setResult({ error: 'В таблице несколько подразделений. Загрузите её на вкладке «Должности» кнопкой «Загрузить таблицу».', problems: [] });
    const incoming = table.blocks.flatMap(b => b.positions);
    if (!incoming.length) return setResult({ error: 'Должности не найдены. Скопируйте из Excel столбцы с названием и количеством.', problems: table.problems });
    setResult({ done: onTable(incoming), problems: table.problems });
    setText('');
  }
  return <Stack gap="xs" className="staffing-paste">
    <Textarea aria-label="Таблица из Excel" placeholder={'Скопируйте строки в Excel и вставьте сюда, например:\nМаляр строительный\t12\nПлотник\t2'} value={text} onChange={e => setText(e.currentTarget.value)} autosize minRows={3} maxRows={8} />
    <Group gap="xs" justify="space-between"><Group gap="xs"><Text size="xs" c="dimmed">Одно число — это</Text><SegmentedControl size="xs" value={quantity} onChange={v => setQuantity(v as 'actual' | 'planned')} data={[{ value: 'actual', label: 'Факт' }, { value: 'planned', label: 'План' }]} aria-label="Что означает число в таблице" /></Group>
      <Group gap="xs"><Button size="xs" variant="default" onClick={onCancel}>Закрыть</Button><Button size="xs" disabled={!text.trim()} onClick={apply}>Внести в список</Button></Group></Group>
    {result.error && <Alert color="red" p="xs">{result.error}</Alert>}
    {result.done && <Text size="xs">✓ {result.done}</Text>}
    {result.problems.map(p => <Text key={p} size="xs" c="var(--status-warning)">△ {p}</Text>)}
  </Stack>;
}

/** Вкладка «Должности»: все должности среза с поиском, переносом между подразделениями, сводкой по названиям и выгрузкой. */
export function PositionsTab({ period, previous, canEdit, canExport, group, onGroup, onSave }: { period: StaffingPeriod; previous?: StaffingPeriod; canEdit: boolean; canExport: boolean; group?: string; onGroup: (group: string | undefined) => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [sort, setSort] = useState('department');
  const [view, setView] = useState('list');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<StaffingPosition | null>(null);
  const [importing, setImporting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = period.rows.filter(r => !r.isArchived);
  const names = useMemo(() => new Map(period.rows.map(r => [r.id, r.department])), [period.rows]);
  const nameOf = (p: StaffingPosition) => (p.rowId && names.get(p.rowId)) || `Без подразделения · ${p.group}`;
  const active = useMemo(() => staffingActivePositions(period), [period]);
  const hasUnlinked = active.some(p => !p.rowId);
  const previousOf = useMemo(() => new Map((previous?.positions ?? []).filter(p => !p.isArchived).map(p => [`${p.rowId}|${staffingTitleKey(p.title)}`, p])), [previous]);
  const filtered = useMemo(() => {
    const key = staffingTitleKey(q);
    const list = (state === 'archived' ? (period.positions ?? []).filter(p => p.isArchived) : active)
      .filter(p => !key || staffingTitleKey(p.title).includes(key))
      .filter(p => !group || p.group === group)
      .filter(p => !dept || (dept === 'none' ? !p.rowId : p.rowId === dept))
      .filter(p => state === 'need' ? (need(p) ?? 0) > 0 : state === 'noplan' ? p.planned == null : state === 'nofact' ? p.actual == null : true);
    return [...list].sort((a, b) => sort === 'title' ? byTitle(a, b) : sort === 'actual' ? (b.actual ?? -1) - (a.actual ?? -1) : sort === 'need' ? (need(b) ?? -1) - (need(a) ?? -1) : nameOf(a).localeCompare(nameOf(b), 'ru') || byTitle(a, b));
  }, [active, period.positions, q, group, dept, state, sort, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = staffingPositionTotals(filtered.map(p => ({ ...p, isArchived: false })));
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const current = Math.min(page, pages);
  const chosen = selected.filter(id => filtered.some(p => p.id === id));
  const summary = useMemo(() => {
    const map = new Map<string, { title: string; rows: Set<string>; items: StaffingPosition[] }>();
    for (const p of filtered) {
      const k = staffingTitleKey(p.title);
      const e = map.get(k) ?? { title: p.title, rows: new Set<string>(), items: [] };
      e.rows.add(p.rowId ?? p.group); e.items.push(p); map.set(k, e);
    }
    return [...map.values()].map(e => ({ title: e.title, departments: e.rows.size, ...staffingPositionTotals(e.items.map(p => ({ ...p, isArchived: false }))) })).sort((a, b) => (b.actual ?? -1) - (a.actual ?? -1) || a.title.localeCompare(b.title, 'ru'));
  }, [filtered]);
  const resetPage = () => { setPage(1); setSelected([]); };
  async function commit(next: StaffingPosition[]) {
    const duplicate = staffingDuplicatePosition(next);
    if (duplicate) { setError(`Должность «${duplicate}» уже есть в этом подразделении. Измените название или отправьте одну из них в архив.`); return false; }
    setBusy(true); setError('');
    try { await onSave(staffingSetPositions(period, next)); setSelected([]); return true; }
    catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  const all = period.positions ?? [];
  const archiveSelected = (ids: string[], isArchived: boolean) => commit(all.map(p => ids.includes(p.id) ? { ...p, isArchived } : p));
  const exportFound = () => download(`Должности ${period.asOf}.csv`, [
    ['Дата среза', 'Подразделение', 'Группа', 'Должность', 'План, ед.', 'Факт, чел.', 'Потребность', 'Архив'],
    ...filtered.map(p => [period.asOf, nameOf(p), p.group, p.title, p.planned, p.actual, need(p), p.isArchived ? 'Да' : 'Нет']),
  ]);
  const newPosition = (): StaffingPosition => ({ id: uuid(), group: rows.find(r => r.id === dept) ? staffingGroupOf(rows.find(r => r.id === dept)!) : group ?? '', rowId: rows.find(r => r.id === dept)?.id, title: '', planned: null, actual: null, isArchived: false });
  return <Stack gap="sm">
    <Group gap="xs" className="staffing-controls">
      <TextInput aria-label="Поиск должности" placeholder="Поиск должности" leftSection={<IconSearch size={16} />} value={q} onChange={e => { setQ(e.currentTarget.value); resetPage(); }} style={{ flex: '1 1 200px' }} />
      <Select aria-label="Подразделение" placeholder="Все подразделения" searchable clearable data={[...(hasUnlinked ? [{ value: 'none', label: 'Без подразделения' }] : []), ...rows.map(r => ({ value: r.id, label: r.department }))]} value={dept} onChange={v => { setDept(v); resetPage(); }} w={230} />
      {(group || rows.length > staffingGroups(rows).length) && <Select aria-label="Группа" placeholder="Все группы" searchable clearable data={[...new Set([...staffingGroups(rows).map(g => g.group), ...(group ? [group] : [])])]} value={group ?? null} onChange={v => { onGroup(v ?? undefined); resetPage(); }} w={190} />}
      <Select aria-label="Состояние" placeholder="Все состояния" clearable data={[{ value: 'need', label: 'Есть потребность' }, { value: 'noplan', label: 'Нет плана' }, { value: 'nofact', label: 'Нет факта' }, { value: 'archived', label: 'Архив должностей' }]} value={state} onChange={v => { setState(v); resetPage(); }} w={170} />
      <Select aria-label="Сортировка" data={[{ value: 'department', label: 'По подразделению' }, { value: 'title', label: 'По названию' }, { value: 'actual', label: 'По факту ↓' }, { value: 'need', label: 'По потребности ↓' }]} value={sort} onChange={v => setSort(v ?? 'department')} w={175} allowDeselect={false} />
    </Group>
    <Group justify="space-between" gap="xs">
      <Group gap="xs"><SegmentedControl size="xs" value={view} onChange={v => { setView(v); setSelected([]); }} data={[{ value: 'list', label: 'Список' }, { value: 'titles', label: 'Сводка по названиям' }]} aria-label="Вид таблицы должностей" />
        <Text size="xs" c="dimmed">Найдено {filtered.length} из {active.length} · план {n(totals.planned)} · факт {n(totals.actual)} · нужно {n(totals.need)}</Text></Group>
      <Group gap="xs">
        {canExport && filtered.length > 0 && <Button size="xs" variant="subtle" leftSection={<IconDownload size={14} />} onClick={exportFound}>Выгрузить найденное</Button>}
        {canEdit && <Button size="xs" variant="default" leftSection={<IconTableImport size={14} />} onClick={() => setImporting(true)}>Загрузить таблицу</Button>}
        {canEdit && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing(newPosition())}>Должность</Button>}
      </Group>
    </Group>
    {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
    {canEdit && chosen.length > 0 && <Group className="staffing-bulk" p="xs" gap="xs"><Text size="sm">Выбрано: {chosen.length}</Text>
      {state !== 'archived' && <Button size="xs" variant="default" onClick={() => setMoving(true)}>Перенести в подразделение</Button>}
      <Button size="xs" variant="default" loading={busy} onClick={() => archiveSelected(chosen, state !== 'archived')}>{state === 'archived' ? 'Восстановить' : 'В архив'}</Button>
      <Button size="xs" variant="subtle" onClick={() => setSelected([])}>Снять выбор</Button></Group>}
    {view === 'titles' ? <Table.ScrollContainer minWidth={520}><Table highlightOnHover verticalSpacing="xs" className="staffing-table">
      <Table.Thead><Table.Tr><Table.Th>Должность</Table.Th><Table.Th ta="right">Подразделений</Table.Th><Table.Th ta="right">План, ед.</Table.Th><Table.Th ta="right">Факт, чел.</Table.Th><Table.Th ta="right">Потребность</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{summary.map(s => <Table.Tr key={s.title}><Table.Td><UnstyledButton className="staffing-department" onClick={() => { setQ(s.title); setView('list'); resetPage(); }}>{s.title}</UnstyledButton></Table.Td><Table.Td ta="right">{s.departments}</Table.Td><Table.Td ta="right">{n(s.planned)}</Table.Td><Table.Td ta="right">{n(s.actual)}</Table.Td><Table.Td ta="right"><NeedCell value={s.need} /></Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer> : <Table.ScrollContainer minWidth={760}><Table highlightOnHover verticalSpacing="xs" className="staffing-table">
      <Table.Thead><Table.Tr>{canEdit && <Table.Th w={36}><Checkbox aria-label="Выбрать все найденные должности" checked={filtered.length > 0 && chosen.length === filtered.length} indeterminate={chosen.length > 0 && chosen.length < filtered.length} onChange={e => setSelected(e.currentTarget.checked ? filtered.map(p => p.id) : [])} /></Table.Th>}<Table.Th>Должность</Table.Th><Table.Th>Подразделение</Table.Th><Table.Th ta="right">План, ед.</Table.Th><Table.Th ta="right">Факт, чел.</Table.Th><Table.Th ta="right">Потребность</Table.Th><Table.Th ta="right">Изм., чел.</Table.Th>{canEdit && <Table.Th w={40} />}</Table.Tr></Table.Thead>
      <Table.Tbody>{filtered.slice((current - 1) * 50, current * 50).map(p => {
        const before = previousOf.get(`${p.rowId}|${staffingTitleKey(p.title)}`);
        const delta = p.actual != null && before?.actual != null ? p.actual - before.actual : null;
        return <Table.Tr key={p.id} data-selected={chosen.includes(p.id) || undefined}>
          {canEdit && <Table.Td><Checkbox aria-label={`Выбрать: ${p.title}`} checked={chosen.includes(p.id)} onChange={e => { const checked = e.currentTarget.checked; setSelected(ids => checked ? [...ids, p.id] : ids.filter(id => id !== p.id)); }} /></Table.Td>}
          <Table.Td>{canEdit ? <UnstyledButton className="staffing-department" onClick={() => setEditing(p)}>{p.title}</UnstyledButton> : p.title}</Table.Td>
          <Table.Td><Text size="xs" c={p.rowId ? 'dimmed' : 'var(--status-warning)'} lineClamp={2}>{p.rowId ? '' : '△ '}{nameOf(p)}</Text></Table.Td>
          <Table.Td ta="right">{n(p.planned)}</Table.Td><Table.Td ta="right">{n(p.actual)}</Table.Td><Table.Td ta="right"><NeedCell value={need(p)} /></Table.Td>
          <Table.Td ta="right">{delta == null ? '—' : `${delta > 0 ? '+' : ''}${n(delta)}`}</Table.Td>
          {canEdit && <Table.Td><Menu position="bottom-end"><Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`Действия: ${p.title}`}><IconDots size={16} /></ActionIcon></Menu.Target><Menu.Dropdown>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(p)}>Редактировать</Menu.Item>
            <Menu.Item leftSection={p.isArchived ? <IconRestore size={14} /> : <IconArchive size={14} />} color={p.isArchived ? undefined : 'red'} onClick={() => archiveSelected([p.id], !p.isArchived)}>{p.isArchived ? 'Восстановить' : 'В архив'}</Menu.Item>
          </Menu.Dropdown></Menu></Table.Td>}
        </Table.Tr>;
      })}</Table.Tbody>
      {filtered.length > 0 && <Table.Tfoot><Table.Tr>{canEdit && <Table.Td />}<Table.Td fw={600} colSpan={2}>Итого по найденным</Table.Td><Table.Td ta="right" fw={600}>{n(totals.planned)}</Table.Td><Table.Td ta="right" fw={600}>{n(totals.actual)}</Table.Td><Table.Td ta="right" fw={600}>{n(totals.need)}</Table.Td><Table.Td colSpan={canEdit ? 2 : 1} /></Table.Tr></Table.Tfoot>}
    </Table></Table.ScrollContainer>}
    {!filtered.length && <Stack align="center" py="lg" gap="xs"><Text c="dimmed">{active.length || state === 'archived' ? 'Должности не найдены' : 'В этом срезе должностей пока нет'}</Text>{canEdit && !active.length && state !== 'archived' && <Text size="sm" c="dimmed">Добавьте их по одной или загрузите таблицу из Excel.</Text>}</Stack>}
    {view === 'list' && filtered.length > 50 && <Pagination total={pages} value={current} onChange={setPage} />}
    <TitleOptions period={period} />
    {editing && <PositionDialog position={editing} isNew={!all.some(p => p.id === editing.id)} rows={rows} onClose={() => setEditing(null)} onSave={async next => { await onSave(staffingSetPositions(period, all.some(p => p.id === next.id) ? all.map(p => p.id === next.id ? next : p) : [...all, next])); }} all={all} />}
    {moving && <MoveDialog count={chosen.length} rows={rows} busy={busy} error={error} onClose={() => setMoving(false)} onMove={async rowId => { if (await commit(all.map(p => chosen.includes(p.id) ? { ...p, rowId } : p))) setMoving(false); }} />}
    {importing && <TableImportDialog period={period} onClose={() => setImporting(false)} onSave={onSave} />}
  </Stack>;
}

function PositionDialog({ position, isNew, rows, all, onClose, onSave }: { position: StaffingPosition; isNew: boolean; rows: StaffingRow[]; all: StaffingPosition[]; onClose: () => void; onSave: (p: StaffingPosition) => Promise<void> }) {
  const [value, setValue] = useState(position);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (p: Partial<StaffingPosition>) => setValue(v => ({ ...v, ...p }));
  const row = rows.find(r => r.id === value.rowId);
  async function save() {
    if (!row && !position.group) { setFields({ rowId: 'Выберите подразделение' }); return; }
    const parsed = staffingPositionSchema.safeParse({ ...value, group: row ? staffingGroupOf(row) : position.group });
    if (!parsed.success) { setFields(Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]))); return; }
    if (staffingDuplicatePosition([...all.filter(p => p.id !== value.id), parsed.data])) { setFields({ title: 'Такая должность в этом подразделении уже есть' }); return; }
    setBusy(true); setError(''); setFields({});
    try { await onSave(parsed.data); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title={isNew ? 'Новая должность' : 'Должность'}>
    <Stack gap="sm">
      <Select label="Подразделение" searchable data={rows.map(r => ({ value: r.id, label: r.department }))} value={value.rowId ?? null} onChange={v => change({ rowId: v ?? undefined })} error={fields.rowId} required allowDeselect={false} comboboxProps={{ zIndex: 1000 }} placeholder={value.rowId ? undefined : position.group || 'Выберите подразделение'} />
      <TextInput label="Должность" list="staffing-titles" value={value.title} onChange={e => change({ title: e.currentTarget.value })} error={fields.title} required data-autofocus />
      <SimpleGrid cols={2}>
        <NumberInput label="План, ед." value={value.planned ?? ''} onChange={v => change({ planned: num(v) })} min={0} allowNegative={false} decimalScale={2} error={fields.planned} />
        <NumberInput label="Факт, чел." value={value.actual ?? ''} onChange={v => change({ actual: num(v) })} min={0} allowNegative={false} allowDecimal={false} error={fields.actual} />
      </SimpleGrid>
      <Text size="xs" c="dimmed">Пустое поле — нет данных. Ноль — подтверждённое нулевое значение. Если итог подразделения совпадал с суммой должностей, он обновится сам.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={save}>Сохранить</Button></Group>
    </Stack>
  </Modal>;
}

function MoveDialog({ count, rows, busy, error, onClose, onMove }: { count: number; rows: StaffingRow[]; busy: boolean; error: string; onClose: () => void; onMove: (rowId: string) => void }) {
  const [rowId, setRowId] = useState<string | null>(null);
  return <Modal opened onClose={onClose} title={`Перенести должности: ${count}`}>
    <Stack gap="sm">
      <Select label="В подразделение" searchable data={rows.map(r => ({ value: r.id, label: r.department }))} value={rowId} onChange={setRowId} comboboxProps={{ zIndex: 1000 }} />
      <Text size="xs" c="dimmed">Итоги подразделений обновятся, если совпадали с суммой должностей.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!rowId} onClick={() => rowId && onMove(rowId)}>Перенести</Button></Group>
    </Stack>
  </Modal>;
}

/** Загрузка всей таблицы в срез: вставка → проверка блоков и сумм → применение одним сохранением (с записью в журнал). */
function TableImportDialog({ period, onClose, onSave }: { period: StaffingPeriod; onClose: () => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const [text, setText] = useState('');
  const [step, setStep] = useState<'paste' | 'check'>('paste');
  const [quantity, setQuantity] = useState<'actual' | 'planned'>('actual');
  // в разделе должности ведутся без разрядов — по умолчанию складываем, чтобы совпасть с ними и сохранить план
  const [merge, setMerge] = useState(() => { const list = (period.positions ?? []).filter(p => !p.isArchived); return list.length > 0 && !list.some(p => staffingTitleBase(p.title) !== p.title.trim()); });
  const [updateMissing, setUpdateMissing] = useState(true);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = period.rows.filter(r => !r.isArchived);
  const table = useMemo(() => { const t = parseStaffingTable(text, quantity); return merge ? staffingMergeGrades(t) : t; }, [text, quantity, merge]);
  const targetOf = (i: number) => targets[i] ?? staffingMatchRow(rows, table.blocks[i].name)?.id ?? (table.blocks[i].name ? 'new' : 'skip');
  const items = table.blocks.map((block, i) => ({ block, target: targetOf(i) })).filter(x => x.target !== 'skip').map(x => ({ block: x.block, rowId: x.target === 'new' ? null : x.target }));
  const twice = items.filter(x => x.rowId).length !== new Set(items.filter(x => x.rowId).map(x => x.rowId)).size;
  let dry = 0;
  const preview = step === 'check' ? staffingApplyTable(period, items, { updateMissing, makeId: () => `preview-${++dry}` }).summary : null;
  const blockSum = (b: (typeof table.blocks)[number]) => staffingPositionTotals(b.positions.map(p => ({ ...p, id: p.title, group: '-', isArchived: false })));
  const sumAll = table.blocks.reduce((s, b) => s + (b.actual ?? blockSum(b).actual ?? 0), 0);
  function check() {
    if (!table.blocks.some(b => b.positions.length)) { setError('Должности не найдены. Скопируйте лист целиком: № / Должность / Количество.'); return; }
    setError(''); setTargets({}); setStep('check');
  }
  async function apply() {
    if (twice) { setError('Два блока указывают на одно подразделение. Выберите разные или отметьте «Не загружать».'); return; }
    const result = staffingApplyTable(period, items, { updateMissing, makeId: uuid });
    const parsed = staffingPeriodWriteSchema.safeParse(result.data);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join('. ')); return; }
    setBusy(true); setError('');
    try {
      await onSave(parsed.data);
      notifications.show({ color: 'green', message: `Таблица загружена: добавлено должностей ${result.summary.added}, обновлено ${result.summary.updated}, вакансий с фактом 0: ${result.summary.vacant}, в архив ${result.summary.archived}` });
      onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title={`Загрузить таблицу должностей в срез ${period.asOf.split('-').reverse().join('.')}`} size="xl" closeOnClickOutside={false}>
    {step === 'paste' ? <Stack gap="sm">
      <Text size="sm">В Excel откройте лист с должностями, выделите таблицу (Ctrl+A), скопируйте (Ctrl+C) и вставьте сюда (Ctrl+V). Строка без номера — подразделение с итогом, строка с номером — должность, как в листе «По должностям». Данные читаются только из вставленного текста, файл никуда не отправляется.</Text>
      <Textarea aria-label="Таблица должностей" placeholder={'№\tДолжность\tКоличество сотрудников\n\tРСУ-1\t524\n1\tВедущий инженер\t4\n2\tВедущий специалист\t4'} value={text} onChange={e => setText(e.currentTarget.value)} autosize minRows={8} maxRows={16} data-autofocus />
      <Group gap="xs"><Text size="sm">Одно число в строке — это</Text><SegmentedControl size="xs" value={quantity} onChange={v => setQuantity(v as 'actual' | 'planned')} data={[{ value: 'actual', label: 'Факт, чел.' }, { value: 'planned', label: 'План, ед.' }]} aria-label="Что означает число в таблице" /></Group>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button disabled={!text.trim()} onClick={check}>Проверить</Button></Group>
    </Stack> : <Stack gap="sm">
      <Table.ScrollContainer minWidth={640} mah={360}><Table verticalSpacing={4} stickyHeader className="staffing-editor">
        <Table.Thead><Table.Tr><Table.Th>В таблице</Table.Th><Table.Th w={260}>В подразделение</Table.Th><Table.Th w={80} ta="right">Строк</Table.Th><Table.Th w={110} ta="right">Сумма / итог</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{table.blocks.map((b, i) => {
          const sum = blockSum(b).actual ?? blockSum(b).planned;
          const control = b.actual ?? b.planned;
          return <Table.Tr key={`${b.name}-${i}`}>
            <Table.Td><Text size="sm">{b.name ?? 'Без названия'}</Text></Table.Td>
            <Table.Td><Select size="xs" aria-label={`Подразделение для: ${b.name ?? 'без названия'}`} searchable allowDeselect={false} comboboxProps={{ zIndex: 1000 }} data={[{ value: 'new', label: b.name ? '+ Создать новое' : '+ Создать «Новое подразделение»' }, { value: 'skip', label: 'Не загружать' }, ...rows.map(r => ({ value: r.id, label: r.department }))]} value={targetOf(i)} onChange={v => v && setTargets(s => ({ ...s, [i]: v }))} /></Table.Td>
            <Table.Td ta="right">{b.positions.length}</Table.Td>
            <Table.Td ta="right">{control != null && sum !== control ? <Tooltip label="Итог в строке подразделения не совпадает с суммой должностей"><Text span size="sm" fw={650} c="var(--status-warning)">△ {n(sum)} / {n(control)}</Text></Tooltip> : <>✓ {n(sum)}</>}</Table.Td>
          </Table.Tr>;
        })}</Table.Tbody>
      </Table></Table.ScrollContainer>
      {table.total != null && <Text size="sm" c={table.total === sumAll ? 'dimmed' : 'var(--status-warning)'}>{table.total === sumAll ? '✓' : '△'} Общий итог таблицы: {n(table.total)}, сумма по подразделениям: {n(sumAll)}</Text>}
      {table.problems.length > 0 && <Alert color="orange" p="xs" title={`△ Замечания: ${table.problems.length}`}><Stack gap={2} mah={110} style={{ overflow: 'auto' }}>{table.problems.map(p => <Text key={p} size="xs">{p}</Text>)}</Stack></Alert>}
      <Stack gap={6}>
        <Checkbox label="Сложить разряды одной должности («Стропальщик 3 разряда» и «4 разряда» → «Стропальщик»)" description="Включите, если должности в разделе ведутся без разрядов: так сохранится уже внесённый план" checked={merge} onChange={e => setMerge(e.currentTarget.checked)} />
        <Checkbox label="Таблица полная: обновить должности, которых в ней нет" description="Только в выбранных подразделениях. Должность с планом останется вакансией с фактом 0, без плана — уйдёт в архив. Выключите, если таблица неполная" checked={updateMissing} onChange={e => setUpdateMissing(e.currentTarget.checked)} />
      </Stack>
      {preview && <Group gap="xs"><Badge variant="light" color="gray">Новых подразделений: {preview.rowsAdded}</Badge><Badge variant="light" color="gray">Добавится должностей: {preview.added}</Badge><Badge variant="light" color="gray">Обновится: {preview.updated}</Badge><Badge variant="light" color="gray">Вакансий с фактом 0: {preview.vacant}</Badge><Badge variant="light" color="gray">В архив: {preview.archived}</Badge></Group>}
      {preview && preview.planLost > 0 && <Text size="sm" c="var(--status-warning)">△ У {preview.planLost} должностей, уходящих в архив, внесён план. У новых строк плана не будет{merge ? '' : ' — включите «Сложить разряды», чтобы план сохранился'}.</Text>}
      {twice && <Text size="sm" c="var(--status-warning)">△ Два блока указывают на одно подразделение</Text>}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="space-between"><Button variant="subtle" onClick={() => { setError(''); setStep('paste'); }}>Назад</Button><Group gap="xs"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!items.length || twice} onClick={apply}>Загрузить в срез</Button></Group></Group>
    </Stack>}
  </Modal>;
}

/** Привязка должностей после правки карточки: другие подразделения не меняются. */
export function withRowPositions(period: StaffingPeriod, row: StaffingRow, positions: StaffingPosition[]): StaffingPeriodData {
  const others = (period.positions ?? []).filter(p => p.rowId !== row.id);
  const all = [...others, ...positions];
  const rows = period.rows.some(r => r.id === row.id) ? period.rows.map(r => r.id === row.id ? row : r) : [...period.rows, row];
  return staffingLinkPositions({ ...period, rows, positions: all.length || period.positions ? all : undefined });
}
