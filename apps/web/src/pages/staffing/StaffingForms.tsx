import { useState } from 'react';
import { Alert, Autocomplete, Button, Group, Modal, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STAFFING_CATEGORIES, staffingGroupOf, staffingGroups, staffingPeriodSchema, staffingPayrollSchema, staffingRowSchema, type StaffingEditors, type StaffingPeriod, type StaffingPeriodData, type StaffingPayroll, type StaffingPayrollData, type StaffingRow } from '@mvs/shared';
import { api } from '../../api';

const num = (value: string | number) => value === '' ? null : Number(value);
const message = (e: unknown) => e instanceof Error ? e.message : 'Не удалось сохранить';
export function RowEditor({ row, period, canEdit, onClose, onSave }: { row: StaffingRow; period: StaffingPeriod; canEdit: boolean; onClose: () => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const [value, setValue] = useState(row);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const change = (p: Partial<StaffingRow>) => setValue(v => ({ ...v, ...p }));
  async function save() {
    const parsed = staffingRowSchema.safeParse(value);
    if (!parsed.success) { setFields(Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]))); return; }
    setBusy(true); setError('');
    try { await onSave({ ...period, rows: period.rows.some(r => r.id === value.id) ? period.rows.map(r => r.id === value.id ? parsed.data : r) : [...period.rows, parsed.data] }); onClose(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title={canEdit ? 'Подразделение' : 'Карточка подразделения'} size="lg">
    <Stack gap="sm">
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
      <Textarea label="Функции подразделения" value={value.function} onChange={e => change({ function: e.currentTarget.value })} autosize minRows={3} maxRows={8} disabled={!canEdit} />
      <Textarea label="Примечание" value={value.note} onChange={e => change({ note: e.currentTarget.value })} disabled={!canEdit} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Закрыть</Button>{canEdit && <Button loading={busy} onClick={save}>Сохранить</Button>}</Group>
    </Stack>
  </Modal>;
}

export function PeriodEditor({ periods, initial, onClose, onSave }: { periods: StaffingPeriod[]; initial?: StaffingPeriod; onClose: () => void; onSave: (data: StaffingPeriodData) => Promise<void> }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
  const [month, setMonth] = useState(initial?.month ?? today.slice(0, 7));
  const [asOf, setAsOf] = useState(initial?.asOf ?? today);
  const [copy, setCopy] = useState<string | null>(null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const base = periods.find(p => p.month === copy);
    const data = { month, asOf, note: note || (base ? `Штат скопирован со среза ${base.asOf}. Факт требует заполнения.` : ''), rows: initial?.rows ?? base?.rows.filter(r => !r.isArchived).map(r => ({ ...r, actual: null, note: '' })) ?? [] };
    const parsed = staffingPeriodSchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join('. ')); return; }
    setBusy(true); setError('');
    try { await onSave(parsed.data); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title={initial ? 'Настройки среза' : 'Новый месячный срез'}>
    <Stack gap="sm">
      <TextInput type="month" label="Месяц" value={month} disabled={!!initial} onChange={e => { const v = e.currentTarget.value; setMonth(v); setAsOf(`${v}-01`); }} required />
      <TextInput type="date" label="Данные на дату" value={asOf} onChange={e => setAsOf(e.currentTarget.value)} required />
      {!initial && <Select label="Скопировать подразделения и штат" placeholder="Пустой срез" clearable data={periods.filter(p => !p.isArchived).map(p => ({ value: p.month, label: p.asOf.split('-').reverse().join('.') }))} value={copy} onChange={setCopy} />}
      {copy && <Text size="xs" c="dimmed">Факт в новом срезе будет пустым. Исходный срез сохранится.</Text>}
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
