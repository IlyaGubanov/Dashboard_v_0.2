import { useMemo, useState } from 'react';
import { Alert, Autocomplete, Button, Checkbox, Group, Modal, MultiSelect, NativeSelect, NumberInput, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { STAFFING_CATEGORIES, staffingCopyStructure, staffingDuplicatePosition, staffingGroupOf, staffingGroupRenameSchema, staffingGroups, staffingPeriodWriteSchema, staffingPayrollSchema, staffingPositionSchema, staffingPositionTotals, staffingRowSchema, staffingSyncRow, staffingTitleKey, staffingTotalsDiffer, type StaffingEditors, type StaffingPeriod, type StaffingPeriodData, type StaffingPayroll, type StaffingPayrollData, type StaffingPosition, type StaffingRow } from '@mvs/shared';
import { api } from '../../api';
import { PositionsEditor, TitleOptions, TotalsHint, withRowPositions } from './StaffingPositions';

const num = (value: string | number) => value === '' ? null : Number(value);
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const message = (e: unknown) => e instanceof Error ? e.message : 'Не удалось сохранить';
/** Карточка подразделения: основные сведения и его должности сохраняются вместе, одной записью в журнале. */
export function RowEditor({ row, period, canEdit, tab, onClose, onSave }: { row: StaffingRow; period: StaffingPeriod; canEdit: boolean; tab?: 'main' | 'positions'; onClose: () => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const [value, setValue] = useState(row);
  const [positions, setPositions] = useState<StaffingPosition[]>(() => (period.positions ?? []).filter(p => p.rowId === row.id).sort((a, b) => a.title.localeCompare(b.title, 'ru')));
  const [active, setActive] = useState<string | null>(tab ?? 'main');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [positionErrors, setPositionErrors] = useState<Record<string, string>>({});
  const saved = useMemo(() => new Set((period.positions ?? []).map(p => p.id)), [period.positions]);
  const change = (p: Partial<StaffingRow>) => setValue(v => ({ ...v, ...p }));
  const changePositions = (next: StaffingPosition[]) => { setValue(v => staffingSyncRow(v, positions, next)); setPositions(next); };
  async function save() {
    const parsed = staffingRowSchema.safeParse(value);
    const errors = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
    setFields(errors);
    const group = staffingGroupOf(value.department.trim().length >= 2 ? value : { department: 'Новое подразделение' });
    const checked = positions.map(p => ({ id: p.id, result: staffingPositionSchema.safeParse({ ...p, group }) }));
    const titles: Record<string, string> = Object.fromEntries(checked.flatMap(c => c.result.success ? [] : [[c.id, c.result.error.issues[0].message]]));
    const duplicate = staffingDuplicatePosition(positions);
    if (duplicate) for (const p of positions) if (!p.isArchived && staffingTitleKey(p.title) === staffingTitleKey(duplicate)) titles[p.id] = 'Такая должность уже есть';
    setPositionErrors(titles);
    if (Object.keys(titles).length) { setActive('positions'); return; }
    if (!parsed.success) { setActive('main'); return; }
    setBusy(true); setError('');
    try { await onSave(withRowPositions(period, parsed.data, checked.map(c => c.result.data!))); onClose(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const count = positions.filter(p => !p.isArchived).length;
  return <Modal opened onClose={onClose} title={value.department || (canEdit ? 'Новое подразделение' : 'Карточка подразделения')} size="xl" closeOnClickOutside={false}>
    <Stack gap="sm">
      <Tabs value={active} onChange={setActive} keepMounted>
        <Tabs.List><Tabs.Tab value="main">Основное</Tabs.Tab><Tabs.Tab value="positions">Должности{count ? ` (${count})` : ''}</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="main" pt="sm"><Stack gap="sm">
          <TextInput label="Подразделение" value={value.department} onChange={e => change({ department: e.currentTarget.value })} disabled={!canEdit} error={fields.department} required />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Категория" data={[...STAFFING_CATEGORIES]} value={value.category} onChange={v => change({ category: v as StaffingRow['category'] })} disabled={!canEdit} error={fields.category} allowDeselect={false} comboboxProps={{ zIndex: 1000 }} />
            <Autocomplete label="Группа на диаграмме" description="Пусто — определяется по названию" placeholder={staffingGroupOf({ department: value.department })} data={staffingGroups(period.rows).map(g => g.group)} value={value.group ?? ''} onChange={group => change({ group })} disabled={!canEdit} error={fields.group} comboboxProps={{ zIndex: 1000 }} />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <NumberInput label="Штат, ед." value={value.planned ?? ''} onChange={v => change({ planned: num(v) })} min={0} decimalScale={2} disabled={!canEdit} error={fields.planned} />
            <NumberInput label="Факт, чел." value={value.actual ?? ''} onChange={v => change({ actual: num(v) })} min={0} allowDecimal={false} disabled={!canEdit} error={fields.actual} />
          </SimpleGrid>
          <Text size="xs" c="dimmed">Пустое поле — нет данных. Ноль — подтверждённое нулевое значение.</Text>
          <TotalsHint row={value} positions={positions} canEdit={canEdit} onApply={change} />
          <Textarea label="Функции подразделения" value={value.function} onChange={e => change({ function: e.currentTarget.value })} autosize minRows={3} maxRows={8} disabled={!canEdit} />
          <Textarea label="Примечание" value={value.note} onChange={e => change({ note: e.currentTarget.value })} disabled={!canEdit} />
        </Stack></Tabs.Panel>
        <Tabs.Panel value="positions" pt="sm"><Stack gap="xs">
          <PositionsEditor positions={positions} saved={saved} target={{ rowId: value.id, group: staffingGroupOf({ department: value.department, group: value.group }) }} canEdit={canEdit} errors={positionErrors} onChange={changePositions} />
          <TotalsHint row={value} positions={positions} canEdit={canEdit} onApply={change} />
          <TitleOptions period={period} />
        </Stack></Tabs.Panel>
      </Tabs>
      {Object.keys(fields).length > 0 && active !== 'main' && <Alert color="red" p="xs">Проверьте поля на вкладке «Основное»</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Закрыть</Button>{canEdit && <Button loading={busy} onClick={save}>Сохранить</Button>}</Group>
    </Stack>
  </Modal>;
}

/** Правка подразделений таблицей: название, группа, категория, штат и факт сразу по многим строкам, одним сохранением. */
export function RowsTableEditor({ period, rows, onClose, onSave }: { period: StaffingPeriod; rows: StaffingRow[]; onClose: () => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const [items, setItems] = useState(rows);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const totals = useMemo(() => new Map(period.rows.map(r => [r.id, staffingPositionTotals((period.positions ?? []).filter(p => p.rowId === r.id))])), [period]);
  const change = (id: string, patch: Partial<StaffingRow>) => setItems(list => list.map(r => r.id === id ? { ...r, ...patch } : r));
  const groups = staffingGroups(period.rows).map(g => g.group);
  const differs = items.filter(r => { const t = totals.get(r.id); return t?.count && staffingTotalsDiffer(r, t); });
  async function save() {
    const next: Record<string, string> = {};
    const parsed = items.map(r => { const res = staffingRowSchema.safeParse(r); if (!res.success) for (const i of res.error.issues) next[`${r.id}.${i.path.join('.')}`] = i.message; return res.success ? res.data : r; });
    setErrors(next);
    if (Object.keys(next).length) { setError('Проверьте выделенные поля'); return; }
    setBusy(true); setError('');
    try {
      const byId = new Map(parsed.map(r => [r.id, r]));
      await onSave({ ...period, rows: [...period.rows.map(r => byId.get(r.id) ?? r), ...parsed.filter(r => !period.rows.some(x => x.id === r.id))] });
      onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title={`Редактирование таблицей: ${items.length}`} size={1100} closeOnClickOutside={false}>
    <Stack gap="sm">
      <Group justify="space-between" gap="xs"><Text size="xs" c="dimmed">В таблице — найденные на вкладке подразделения. Изменения применяются кнопкой «Сохранить». Пустое поле — нет данных.</Text>
        <Group gap="xs">{differs.length > 0 && <Button size="xs" variant="default" onClick={() => setItems(list => list.map(r => { const t = totals.get(r.id); return t?.count ? { ...r, planned: t.planned ?? r.planned, actual: t.actual ?? r.actual } : r; }))}>Подставить суммы должностей ({differs.length})</Button>}
          <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setItems(list => [...list, { id: crypto.randomUUID(), department: '', category: 'ОП', planned: null, actual: null, note: '', function: '', isArchived: false }])}>Строка</Button></Group></Group>
      <Table.ScrollContainer minWidth={860} maxHeight={520} scrollAreaProps={{ type: 'auto' }}><Table verticalSpacing={4} stickyHeader className="staffing-editor">
        <Table.Thead><Table.Tr><Table.Th>Подразделение</Table.Th><Table.Th w={220}>Группа</Table.Th><Table.Th w={84}>Категория</Table.Th><Table.Th w={92} ta="right">Штат, ед.</Table.Th><Table.Th w={92} ta="right">Факт, чел.</Table.Th><Table.Th w={120} ta="right">По должностям</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{items.map(r => { const t = totals.get(r.id); return <Table.Tr key={r.id}>
          <Table.Td><TextInput size="xs" aria-label="Подразделение" value={r.department} onChange={e => change(r.id, { department: e.currentTarget.value })} error={errors[`${r.id}.department`]} /></Table.Td>
          <Table.Td><TextInput size="xs" aria-label={`Группа: ${r.department}`} list="staffing-groups" placeholder={staffingGroupOf({ department: r.department })} value={r.group ?? ''} onChange={e => change(r.id, { group: e.currentTarget.value })} error={errors[`${r.id}.group`]} /></Table.Td>
          <Table.Td><NativeSelect size="xs" aria-label={`Категория: ${r.department}`} data={[...STAFFING_CATEGORIES]} value={r.category} onChange={e => change(r.id, { category: e.currentTarget.value as StaffingRow['category'] })} /></Table.Td>
          <Table.Td><NumberInput size="xs" hideControls aria-label={`Штат: ${r.department}`} value={r.planned ?? ''} onChange={v => change(r.id, { planned: num(v) })} min={0} allowNegative={false} decimalScale={2} error={errors[`${r.id}.planned`]} /></Table.Td>
          <Table.Td><NumberInput size="xs" hideControls aria-label={`Факт: ${r.department}`} value={r.actual ?? ''} onChange={v => change(r.id, { actual: num(v) })} min={0} allowNegative={false} allowDecimal={false} error={errors[`${r.id}.actual`]} /></Table.Td>
          <Table.Td ta="right"><Text size="xs" c={t?.count && staffingTotalsDiffer(r, t) ? 'var(--status-warning)' : 'dimmed'}>{t?.count ? `${staffingTotalsDiffer(r, t) ? '△ ' : ''}${n(t.planned)} / ${n(t.actual)}` : '—'}</Text></Table.Td>
        </Table.Tr>; })}</Table.Tbody>
      </Table></Table.ScrollContainer>
      <datalist id="staffing-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={save}>Сохранить</Button></Group>
    </Stack>
  </Modal>;
}

/** Переименование или объединение групп: в этом срезе либо во всех срезах и приёме/увольнении. */
export function GroupsDialog({ period, onClose, onDone }: { period: StaffingPeriod; onClose: () => void; onDone: () => Promise<void> }) {
  const groups = staffingGroups(period.rows);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [everywhere, setEverywhere] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const merged = groups.find(g => g.group === to.trim() && g.group !== from);
  async function save() {
    const parsed = staffingGroupRenameSchema.safeParse({ from: from ?? '', to, month: everywhere ? undefined : period.month });
    if (!parsed.success) { setFields(Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]))); return; }
    setBusy(true); setError(''); setFields({});
    try {
      const r = await api<{ periods: number; days: number }>('/staffing/groups/rename', { method: 'POST', body: parsed.data });
      await onDone();
      notifications.show({ color: 'green', message: `Группа изменена: срезов — ${r.periods}, дней приёма и увольнения — ${r.days}` });
      onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title="Группы подразделений">
    <Stack gap="sm">
      <Text size="sm">Группа объединяет подразделения на диаграмме, в должностях и в приёме и увольнении. Если указать название существующей группы, группы объединятся.</Text>
      <Select label="Группа" searchable data={groups.map(g => ({ value: g.group, label: `${g.group} · подразделений: ${g.count}` }))} value={from} onChange={v => { setFrom(v); setTo(v ?? ''); }} error={fields.from} comboboxProps={{ zIndex: 1000 }} />
      <Autocomplete label="Новое название" data={groups.map(g => g.group).filter(g => g !== from)} value={to} onChange={setTo} disabled={!from} error={fields.to} maxLength={120} comboboxProps={{ zIndex: 1000 }} />
      {merged && <Text size="sm" c="var(--status-warning)">△ Группа «{merged.group}» уже есть: они объединятся, приём и увольнение за один день сложатся. Разъединить можно только вручную.</Text>}
      <Checkbox label="Во всех срезах и в приёме и увольнении" description="Выключите, чтобы изменить только срез, который открыт сейчас" checked={everywhere} onChange={e => setEverywhere(e.currentTarget.checked)} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!from || !to.trim() || to.trim() === from} onClick={save}>{merged ? 'Объединить' : 'Переименовать'}</Button></Group>
    </Stack>
  </Modal>;
}

export function PeriodEditor({ periods, initial, onClose, onSave }: { periods: StaffingPeriod[]; initial?: StaffingPeriod; onClose: () => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
  const [month, setMonth] = useState(initial?.month ?? today.slice(0, 7));
  const [asOf, setAsOf] = useState(initial?.asOf ?? today);
  const [copy, setCopy] = useState<string | null>(null);
  const [copyPositions, setCopyPositions] = useState(true);
  const [copyActual, setCopyActual] = useState(false);
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const base = periods.find(p => p.month === copy);
    // настройки среза не трогают состав: подразделения и должности сохраняются как есть
    const structure = initial ? { rows: initial.rows, positions: initial.positions } : base ? staffingCopyStructure(base, { positions: copyPositions, actual: copyActual }) : { rows: [] };
    const data = { month, asOf, note: note || (base ? copyActual ? `Штат и факт скопированы со среза ${base.asOf}. Проверьте факт.` : `Штат скопирован со среза ${base.asOf}. Факт требует заполнения.` : ''), ...structure };
    const parsed = staffingPeriodWriteSchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join('. ')); return; }
    setBusy(true); setError('');
    try { await onSave(parsed.data); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title={initial ? 'Настройки среза' : 'Новый месячный срез'}>
    <Stack gap="sm">
      <TextInput type="month" label="Месяц" value={month} disabled={!!initial} onChange={e => { const v = e.currentTarget.value; setMonth(v); setAsOf(`${v}-01`); }} required />
      <TextInput type="date" label="Данные на дату" value={asOf} onChange={e => setAsOf(e.currentTarget.value)} required />
      {!initial && <Select label="Скопировать подразделения и штат" placeholder="Пустой срез" clearable data={periods.filter(p => !p.isArchived).map(p => ({ value: p.month, label: p.asOf.split('-').reverse().join('.') }))} value={copy} onChange={setCopy} />}
      {copy && <Checkbox label="Скопировать должности" checked={copyPositions} onChange={e => setCopyPositions(e.currentTarget.checked)} />}
      {copy && <Checkbox label="Перенести фактическую численность" description="Удобно, когда меняется только часть данных" checked={copyActual} onChange={e => setCopyActual(e.currentTarget.checked)} />}
      {copy && <Text size="xs" c="dimmed">{copyActual ? 'Факт будет скопирован — проверьте его перед сохранением данных.' : 'Факт в новом срезе будет пустым.'} Исходный срез сохранится.</Text>}
      <Textarea label="Источник и примечание" value={note} onChange={e => setNote(e.currentTarget.value)} maxLength={3000} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button onClick={save} loading={busy}>Сохранить срез</Button></Group>
    </Stack>
  </Modal>;
}

export function EditorsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['staffing', 'editors'], queryFn: () => api<StaffingEditors>('/staffing/editors') });
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/staffing/editors', { method: 'PUT', body: { userIds: (chosen ?? query.data!.userIds.map(String)).map(Number) } }); await qc.invalidateQueries({ queryKey: ['staffing'] }); onClose(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title="Ответственные за кадровые данные">
    <Stack gap="sm">
      <Text size="sm">Администратор и куратор направления назначают ответственных. Назначенные сотрудники смогут вести все срезы и ФОТ. Руководство имеет доступ на просмотр. Скрытие раздела и ограничения финансов сохраняют действие.</Text>
      <MultiSelect label="Ответственные" searchable data={query.data?.users.map(u => ({ value: String(u.id), label: `${u.fullName} (${u.login})` })) ?? []} value={chosen ?? query.data?.userIds.map(String) ?? []} onChange={setChosen} disabled={!query.data} />
      {(error || query.error) && <Alert color="red">{error || message(query.error)}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button disabled={!query.data} loading={busy} onClick={save}>Сохранить доступ</Button></Group>
    </Stack>
  </Modal>;
}

export function PayrollEditor({ initial, period, onClose, onSave }: { initial?: StaffingPayroll; period?: StaffingPeriod; onClose: () => void; onSave: (data: StaffingPayrollData) => Promise<void> }) {
  const [value, setValue] = useState<StaffingPayrollData>(initial ?? { year: new Date().getFullYear(), label: 'Годовой ФОТ', rows: period?.rows.filter(r => !r.isArchived).map(r => ({ id: r.id, department: r.department, category: r.category, amount: null })) ?? [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  async function save() {
    const parsed = staffingPayrollSchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join('. ')); return; }
    setBusy(true); setError('');
    try { await onSave(parsed.data); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title="Редактировать годовой ФОТ" size="xl">
    <Stack gap="sm">
      <SimpleGrid cols={2}><NumberInput label="Год" value={value.year} min={2020} max={2099} disabled={!!initial} onChange={v => setValue(s => ({ ...s, year: Number(v) }))} /><TextInput label="Период / основание" value={value.label} onChange={e => { const label = e.currentTarget.value; setValue(s => ({ ...s, label })); }} /></SimpleGrid>
      <Group justify="space-between"><TextInput placeholder="Поиск подразделения" aria-label="Поиск в редакторе ФОТ" value={search} onChange={e => setSearch(e.currentTarget.value)} /><Button variant="default" size="xs" onClick={() => { setSearch(''); setValue(s => ({ ...s, rows: [...s.rows, { id: crypto.randomUUID(), department: '', category: 'ВП', amount: null }] })); }}>Добавить строку</Button></Group>
      <Table.ScrollContainer minWidth={600} h={390}>
        <Table><Table.Thead><Table.Tr><Table.Th>Подразделение</Table.Th><Table.Th>Категория</Table.Th><Table.Th>ФОТ, млн ₽</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>{value.rows.filter(r => r.department.toLowerCase().includes(search.toLowerCase())).map(r => <Table.Tr key={r.id}>
            <Table.Td><TextInput aria-label="Наименование подразделения ФОТ" value={r.department} onChange={e => { const department = e.currentTarget.value; setValue(s => ({ ...s, rows: s.rows.map(x => x.id === r.id ? { ...x, department } : x) })); }} /></Table.Td>
            <Table.Td w={100}><Select aria-label="Категория ФОТ" data={[...STAFFING_CATEGORIES]} value={r.category} onChange={category => setValue(s => ({ ...s, rows: s.rows.map(x => x.id === r.id ? { ...x, category: category as StaffingRow['category'] } : x) }))} allowDeselect={false} /></Table.Td>
            <Table.Td w={145}><NumberInput aria-label={`ФОТ: ${r.department}`} value={r.amount ?? ''} min={0} decimalScale={2} onChange={v => setValue(s => ({ ...s, rows: s.rows.map(x => x.id === r.id ? { ...x, amount: num(v) } : x) }))} /></Table.Td>
            <Table.Td><Button variant="subtle" color="red" size="xs" onClick={() => setValue(s => ({ ...s, rows: s.rows.filter(x => x.id !== r.id) }))}>Убрать</Button></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={save}>Сохранить ФОТ</Button></Group>
    </Stack>
  </Modal>;
}
