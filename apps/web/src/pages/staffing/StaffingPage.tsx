/** Используем компоненты и иконки действующего приложения (Mantine/Tabler), чтобы раздел наследовал оформление и доступность. */
import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Menu, Modal, Pagination, Paper, Select, SimpleGrid, Skeleton, Stack, Switch, Table, Tabs, Text, TextInput, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { IconArchive, IconCalendar, IconCalendarEvent, IconCategory, IconDots, IconDownload, IconEdit, IconFileImport, IconGauge, IconListDetails, IconPlus, IconPrinter, IconRefresh, IconSearch, IconSettings, IconTableOptions, IconUserCheck, IconUserExclamation, IconUsers, IconUsersGroup } from '@tabler/icons-react';
import { STAFFING_CATEGORIES, staffingDelta, staffingGroupOf, staffingGroups, staffingPositionTotals, staffingTotalsDiffer, summarizeStaffing, type StaffingAuditItem, type StaffingMovementDay, type StaffingPeriod, type StaffingPeriodData, type StaffingPayroll, type StaffingRow } from '@mvs/shared';
import { api, staffingQuery } from '../../api';
import { EChart, baseOption } from '../../ui/EChart';
import { download } from './download';
import { GroupPie, type Measure } from './StaffingGroups';
import { MovementsTab } from './StaffingMovements';
import { PositionsTab } from './StaffingPositions';
import { useFinanceHidden } from '../../ui/finance';
import { EditorsDialog, GroupsDialog, PayrollEditor, PeriodEditor, RowEditor, RowsTableEditor } from './StaffingForms';
import type { StaffingSearch } from './search';
import './staffing.css';

const route = getRouteApi('/app/staffing');
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const d = (v: string) => v.split('-').reverse().join('.');
const gap = (r: StaffingRow) => r.actual == null || r.planned == null ? null : Math.round((r.planned - r.actual) * 100) / 100;
const emptyRow = (): StaffingRow => ({ id: crypto.randomUUID(), department: '', category: 'ОП', planned: null, actual: null, note: '', function: '', isArchived: false });
/** Карточка показателя: у каждой свой тон палитры --cat-* (полоса, фон, значок), значение — обычным цветом текста для читаемости. */
function Stat({ label, value, hint, warning, tooltip, tone, icon }: { label: string; value: string; hint: string; warning?: boolean; tooltip?: string; tone: number; icon: React.ReactNode }) {
  return <Tooltip label={tooltip || hint} multiline w={300}><Paper withBorder p="md" className="staffing-stat" style={{ '--stat-tone': `var(--cat-${tone})`, '--stat-ink': `var(--cat-ink-${tone})` } as React.CSSProperties}>
    <Group gap="xs" wrap="nowrap" justify="space-between" align="flex-start"><Text size="sm" fw={600} className="staffing-stat-label">{label}</Text><span className="staffing-stat-icon" aria-hidden>{icon}</span></Group>
    <Text className="staffing-stat-value" fw={650}>{value}</Text>
    <Text size="xs" c={warning ? 'var(--status-warning)' : 'dimmed'}>{warning ? '△ ' : ''}{hint}</Text>
  </Paper></Tooltip>;
}

const today = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

export function StaffingPage() {
  const query = useQuery(staffingQuery);
  const qc = useQueryClient();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const update = (patch: Partial<StaffingSearch>) => void navigate({ search: s => ({ ...s, ...patch }), replace: true });
  const [editing, setEditing] = useState<{ row: StaffingRow; period: StaffingPeriod; tab?: 'main' | 'positions' } | null>(null);
  const [periodBase, setPeriodBase] = useState<StaffingPeriod | undefined>();
  const [periodForm, setPeriodForm] = useState<'new' | 'edit' | null>(null);
  const [editors, setEditors] = useState(false);
  const [tableEdit, setTableEdit] = useState(false);
  const [groupsForm, setGroupsForm] = useState(false);
  const [payrollForm, setPayrollForm] = useState<StaffingPayroll | 'new' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; action: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [page, setPage] = useState(1);
  const financeHidden = useFinanceHidden();
  const data = query.data;
  const periods = data?.periods ?? [];
  const active = periods.filter(p => !p.isArchived);
  const choices = search.archive ? periods : active;
  const current = choices.find(p => p.month === search.month) ?? choices.at(-1);
  const previous = periods.find(p => p.month === search.compare && p.month !== current?.month && !p.isArchived) ?? active.filter(p => p.month < (current?.month ?? '')).at(-1);
  const stats = summarizeStaffing(current?.rows ?? []);
  const filtered = useMemo(() => {
    const q = search.q?.trim().toLocaleLowerCase('ru') ?? '';
    const rows = (current?.rows ?? []).filter(r => search.status === 'archived' ? r.isArchived : !r.isArchived)
      .filter(r => !q || `${r.department} ${r.note} ${r.id}`.toLocaleLowerCase('ru').includes(q))
      .filter(r => !search.category || r.category === search.category)
      .filter(r => !search.group || staffingGroupOf(r) === search.group)
      .filter(r => !search.status || search.status === 'archived' || (search.status === 'missing' ? r.actual === null || r.planned === null : search.status === 'vacant' ? (gap(r) ?? 0) > 0 : (gap(r) ?? 0) < 0));
    return rows.sort((a, b) => search.sort === 'order' ? 0 : search.sort === 'actual' ? (b.actual ?? -1) - (a.actual ?? -1) : search.sort === 'planned' ? (b.planned ?? -1) - (a.planned ?? -1) : search.sort === 'vacancies' ? (gap(b) ?? -Infinity) - (gap(a) ?? -Infinity) : a.department.localeCompare(b.department, 'ru'));
  }, [current, search.q, search.category, search.status, search.sort, search.group]);
  const selectedVisible = selected.filter(id => filtered.some(r => r.id === id));
  const filteredStats = summarizeStaffing(filtered.map(r => ({ ...r, isArchived: false })));
  const rowTotals = useMemo(() => new Map((current?.rows ?? []).map(r => [r.id, staffingPositionTotals((current?.positions ?? []).filter(p => p.rowId === r.id))])), [current]);
  const canEdit = !!data?.permissions.canEdit;
  const showFinance = !financeHidden && !!data?.canFinance;
  const tab = search.tab === 'payroll' && !showFinance || search.tab === 'journal' && !data?.canAudit ? 'overview' : search.tab ?? 'overview';

  async function refresh() { await qc.invalidateQueries({ queryKey: ['staffing'] }); }
  function setRow(row: StaffingRow | null, tab?: 'main' | 'positions') { setEditing(row && current ? { row, period: current, tab } : null); }
  /** Должности группы: одно подразделение — сразу его карточка, несколько — вкладка «Должности» с фильтром. */
  function editGroup(group: string) {
    const rows = current?.rows.filter(r => !r.isArchived && staffingGroupOf(r) === group) ?? [];
    if (rows.length === 1) setRow(rows[0], 'positions'); else update({ tab: 'positions', group });
  }
  async function savePeriod(value: StaffingPeriodData, isArchived?: boolean, base = current) {
    if (!base) return;
    await api(`/staffing/periods/${base.month}`, { method: 'PUT', body: { version: base.version, data: value, isArchived } });
    await refresh();
    notifications.show({ message: 'Срез сохранён', color: 'green' });
  }
  async function runAction(action: () => Promise<unknown>) {
    setBusy(true); setActionError('');
    try { await action(); await refresh(); setConfirm(null); setSelected([]); }
    catch (e) { setActionError((e as Error).message); } finally { setBusy(false); }
  }
  function archiveRows(ids: string[], archived: boolean) {
    if (!current) return;
    setConfirm({ title: `${archived ? 'Архивировать' : 'Восстановить'} подразделения: ${ids.length}?`, action: () => savePeriod({ ...current, rows: current.rows.map(r => ids.includes(r.id) ? { ...r, isArchived: archived } : r) }) });
  }
  function exportRows() {
    if (!current) return;
    download(`Штатная численность ${current.asOf}.csv`, [
      ['Дата среза', 'Подразделение', 'Группа', 'Категория', 'Штат, ед.', 'Факт, чел.', 'Незакрыто, ед.', 'Превышение, чел.', `Изменение к ${previous?.asOf ?? '—'}`, 'Архив', 'Примечание', 'Функции'],
      ...filtered.map(r => [current.asOf, r.department, staffingGroupOf(r), r.category, r.planned, r.actual, gap(r) == null ? null : Math.max(0, gap(r)!), gap(r) == null ? null : Math.max(0, -gap(r)!), staffingDelta(r, previous?.rows ?? []), r.isArchived ? 'Да' : 'Нет', r.note, r.function]),
    ]);
  }

  if (query.error && !data) return <Alert color="red" title="Не удалось загрузить штатную численность"><Stack gap="sm"><Text size="sm">{query.error.message}</Text><Button variant="default" onClick={() => query.refetch()}>Повторить</Button></Stack></Alert>;
  if (!data) return <Stack><Skeleton height={44} /><SimpleGrid cols={{ base: 2, md: 4 }}>{[1, 2, 3, 4].map(i => <Skeleton key={i} height={108} />)}</SimpleGrid><Skeleton height={320} /></Stack>;

  return <Stack gap="md" className="staffing-page">
    <Group justify="space-between" align="center" className="staffing-header">
      <Group gap="sm"><div className="staffing-title-icon"><IconUsers size={22} /></div><div><Title order={2} size="h3">Штатная численность</Title>
        <Group gap="xs" mt={2} className="staffing-dates">{current ? <Text className="staffing-asof">Данные на {d(current.asOf)}{current.isArchived ? ' · архив' : ''}</Text> : <Text size="sm" c="dimmed">Учёт по подразделениям и категориям</Text>}
          <Badge variant="light" color="gray" size="lg" radius="sm" leftSection={<IconCalendarEvent size={15} />} className="staffing-today">Сегодня {today}</Badge></Group></div></Group>
      <Group gap="xs" className="staffing-controls">
        <Tooltip label="Обновить"><ActionIcon variant="default" aria-label="Обновить штатную численность" loading={query.isFetching} onClick={() => query.refetch()}><IconRefresh size={16} /></ActionIcon></Tooltip>
        <Menu position="bottom-end"><Menu.Target><ActionIcon variant="default" aria-label="Действия раздела"><IconDots size={18} /></ActionIcon></Menu.Target><Menu.Dropdown>
          {data.canExport && current && <Menu.Item leftSection={<IconDownload size={16} />} onClick={exportRows}>Выгрузить реестр в Excel (CSV)</Menu.Item>}
          {data.canExport && <Menu.Item leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Печать для руководства</Menu.Item>}
          {canEdit && current && <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => { setPeriodBase(current); setPeriodForm('edit'); }}>Настройки среза</Menu.Item>}
          {canEdit && current && <Menu.Item leftSection={<IconCategory size={16} />} onClick={() => setGroupsForm(true)}>Группы подразделений</Menu.Item>}
          {data.permissions.canManageEditors && <Menu.Item leftSection={<IconUsers size={16} />} onClick={() => setEditors(true)}>Ответственные за данные</Menu.Item>}
          {canEdit && showFinance && <Menu.Item leftSection={<IconFileImport size={16} />} onClick={() => setConfirm({ title: 'Загрузить исходные срезы (01.01.2025 – 26.10.2026), должности, приём/увольнение (14.09–26.10.2026) и ФОТ за 2024–2026 годы? Добавятся только отсутствующие, существующие данные сохранятся.', action: () => api('/staffing/import-source', { method: 'POST' }) })}>Загрузить исходные данные</Menu.Item>}
          {canEdit && current && <Menu.Item color={current.isArchived ? undefined : 'red'} leftSection={<IconArchive size={16} />} onClick={() => setConfirm({ title: current.isArchived ? 'Восстановить срез?' : 'Архивировать срез? Данные и история сохранятся.', action: () => savePeriod(current, !current.isArchived) })}>{current.isArchived ? 'Восстановить срез' : 'Архивировать срез'}</Menu.Item>}
        </Menu.Dropdown></Menu>
        {canEdit && <Button leftSection={<IconPlus size={16} />} size="sm" onClick={() => setPeriodForm('new')}>Новый срез</Button>}
      </Group>
    </Group>
    {query.error && <Alert color="red">{query.error.message}</Alert>}
    {actionError && !confirm && <Alert color="red" withCloseButton onClose={() => setActionError('')}>{actionError}</Alert>}
    {!periods.length ? <Paper withBorder p="xl"><Stack align="center" gap="sm"><IconCalendar size={32} /><Text fw={600}>Срезов пока нет</Text><Text size="sm" c="dimmed">{canEdit ? 'Загрузите выбранное штатное расписание или создайте первый месячный срез.' : 'Ответственный за данные ещё не добавил срезы.'}</Text>{canEdit && <Button loading={busy} onClick={() => runAction(() => api('/staffing/import-source', { method: 'POST' }))}>Загрузить исходное расписание</Button>}</Stack></Paper> : <>
      <Group gap="sm" align="flex-end" className="staffing-controls">
        <Select label="Срез" aria-label="Срез" leftSection={<IconCalendar size={15} />} data={choices.map(p => ({ value: p.month, label: `${d(p.asOf)}${p.isArchived ? ' · архив' : ''}` }))} value={current?.month ?? null} onChange={v => { update({ month: v ?? undefined }); setSelected([]); setPage(1); }} w={195} allowDeselect={false} />
        <Select label="Сравнить с" aria-label="Сравнить с" data={active.filter(p => p.month !== current?.month).map(p => ({ value: p.month, label: d(p.asOf) }))} value={previous?.month ?? null} onChange={v => update({ compare: v ?? undefined })} w={175} allowDeselect={false} />
        <Switch label="Архив срезов" checked={!!search.archive} onChange={e => update({ archive: e.currentTarget.checked, month: undefined })} mb={9} />
        <Text size="xs" c="dimmed" ml="auto">{canEdit ? 'Редактирование доступно' : 'Просмотр'} · {periods.length} среза</Text>
      </Group>
      {!current ? <Alert color="gray">Активных срезов нет. Включите «Архив срезов», чтобы восстановить данные.</Alert> : <>
        <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" className="staffing-stats">
          <Stat tone={1} icon={<IconUsersGroup size={20} />} label="Штатная численность" value={`${n(stats.planned)} ед.`} hint={`${stats.count - stats.missingPlan} / ${stats.count} подразделений`} warning={stats.missingPlan > 0} tooltip="Сумма известных штатных единиц. Пропуски не заменяются нулями." />
          <Stat tone={3} icon={<IconUserCheck size={20} />} label="Фактическая численность" value={`${n(stats.actual)} чел.`} hint={`${stats.count - stats.missingActual} / ${stats.count} подразделений`} warning={stats.missingActual > 0} tooltip="Сумма заполненного факта. При пропусках это частичная численность, а не подтверждённый общий итог." />
          <Stat tone={2} icon={<IconUserExclamation size={20} />} label={stats.paired < stats.count ? 'Известный дефицит, ед.' : 'Незакрытые единицы'} value={n(stats.vacancies)} hint={`${stats.paired}/${stats.count} сопоставимых · превышение ${n(stats.excess)}`} warning={(stats.vacancies ?? 0) > 0 || stats.paired < stats.count} tooltip={`Сумма положительных разниц штат − факт. По заполненным парам: ${stats.paired} из ${stats.count}. Превышение в других подразделениях не уменьшает дефицит.`} />
          <Stat tone={5} icon={<IconGauge size={20} />} label="Укомплектованность" value={stats.occupancy == null ? '—' : `${n(stats.occupancy * 100)} %`} hint={`${stats.paired} / ${stats.count} сопоставимых`} tooltip="Факт / штат по подразделениям, где заполнены оба показателя. Может превышать 100%." />
        </SimpleGrid>
        <Tabs value={tab} onChange={v => update({ tab: v ?? undefined })}>
          <Tabs.List className="staffing-controls"><Tabs.Tab value="overview">Обзор</Tabs.Tab><Tabs.Tab value="departments">Подразделения</Tabs.Tab><Tabs.Tab value="positions">Должности</Tabs.Tab><Tabs.Tab value="movements">Приём и увольнение</Tabs.Tab>{showFinance && <Tabs.Tab value="payroll">ФОТ по годам</Tabs.Tab>}{data.canAudit && <Tabs.Tab value="journal">Журнал</Tabs.Tab>}</Tabs.List>
          <Tabs.Panel value="overview" pt="md"><Overview periods={active} current={current} previous={previous} open={setRow} movements={data.movements ?? []} measure={search.pie ?? 'actual'} onMeasure={m => update({ pie: m === 'planned' ? m : undefined })} openGroup={group => { update({ tab: 'departments', group, q: undefined, category: undefined, status: undefined }); setPage(1); }} editGroup={canEdit ? editGroup : undefined} /></Tabs.Panel>
          <Tabs.Panel value="positions" pt="md"><PositionsTab period={current} previous={previous} canEdit={canEdit} canExport={data.canExport} group={search.group} onGroup={group => update({ group })} onSave={value => savePeriod(value)} /></Tabs.Panel>
          <Tabs.Panel value="movements" pt="md"><MovementsTab days={data.movements ?? []} groups={staffingGroups(current.rows).map(g => g.group)} canEdit={canEdit} onSaved={refresh} /></Tabs.Panel>
          <Tabs.Panel value="departments" pt="md">
            <Stack gap="sm">
              <Group gap="xs" className="staffing-controls">
                <TextInput aria-label="Поиск подразделения" placeholder="Поиск подразделения" leftSection={<IconSearch size={16} />} value={search.q ?? ''} onChange={e => { update({ q: e.currentTarget.value || undefined }); setPage(1); }} style={{ flex: '1 1 230px' }} />
                <Select aria-label="Категория" placeholder="Все категории" data={[...STAFFING_CATEGORIES]} value={search.category ?? null} clearable onChange={v => { update({ category: v ?? undefined }); setPage(1); }} w={150} />
                <Select aria-label="Группа" placeholder="Все группы" data={[...new Set([...staffingGroups(current.rows).map(g => g.group), ...(search.group ? [search.group] : [])])]} value={search.group ?? null} clearable searchable onChange={v => { update({ group: v ?? undefined }); setPage(1); }} w={200} />
                <Select aria-label="Состояние" placeholder="Все состояния" data={[{ value: 'vacant', label: 'Есть дефицит' }, { value: 'excess', label: 'Превышение' }, { value: 'missing', label: 'Нет данных' }, { value: 'archived', label: 'Архив строк' }]} value={search.status ?? null} clearable onChange={v => { update({ status: v ?? undefined }); setPage(1); }} w={170} />
                <Select aria-label="Сортировка" data={[{ value: 'name', label: 'По названию' }, { value: 'order', label: 'Как в срезе' }, { value: 'actual', label: 'По факту ↓' }, { value: 'planned', label: 'По штату ↓' }, { value: 'vacancies', label: 'По дефициту ↓' }]} value={search.sort ?? 'name'} onChange={v => update({ sort: v ?? undefined })} w={170} allowDeselect={false} />
                {(search.q || search.category || search.status || search.group) && <Button variant="subtle" size="xs" onClick={() => update({ q: undefined, category: undefined, status: undefined, group: undefined })}>Сбросить</Button>}
                {canEdit && filtered.length > 0 && search.status !== 'archived' && <Button variant="default" leftSection={<IconTableOptions size={15} />} onClick={() => setTableEdit(true)}>Редактировать таблицей</Button>}
                {canEdit && <Button variant="default" leftSection={<IconPlus size={15} />} onClick={() => setRow(emptyRow())}>Подразделение</Button>}
              </Group>
              <Group justify="space-between"><Text size="xs" c="dimmed">Найдено {filtered.length} из {current.rows.length} · сводка выше по всему срезу</Text>{data.canExport && <Button size="xs" variant="subtle" leftSection={<IconDownload size={14} />} onClick={exportRows}>Выгрузить найденное</Button>}</Group>
              {canEdit && selectedVisible.length > 0 && <Group className="staffing-bulk" p="xs"><Text size="sm">Выбрано: {selectedVisible.length}</Text><Button size="xs" variant="default" onClick={() => archiveRows(selectedVisible, search.status !== 'archived')}>{search.status === 'archived' ? 'Восстановить' : 'Архивировать'}</Button><Button size="xs" variant="subtle" onClick={() => setSelected([])}>Снять выбор</Button></Group>}
              <Table.ScrollContainer minWidth={820}><Table highlightOnHover verticalSpacing="xs" className="staffing-table">
                <Table.Thead><Table.Tr>{canEdit && <Table.Th w={36}><Checkbox aria-label="Выбрать все найденные подразделения" checked={filtered.length > 0 && selectedVisible.length === filtered.length} indeterminate={selectedVisible.length > 0 && selectedVisible.length < filtered.length} onChange={e => setSelected(e.currentTarget.checked ? filtered.map(r => r.id) : [])} /></Table.Th>}<Table.Th>Подразделение</Table.Th><Table.Th>Категория</Table.Th><Table.Th ta="right">Штат, ед.</Table.Th><Table.Th ta="right">Факт, чел.</Table.Th><Table.Th ta="right">Дефицит, ед.</Table.Th><Table.Th ta="right">Изм., чел.</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                <Table.Tbody>{filtered.slice((Math.min(page, Math.max(1, Math.ceil(filtered.length / 50))) - 1) * 50, Math.min(page, Math.max(1, Math.ceil(filtered.length / 50))) * 50).map(r => {
                  const delta = staffingDelta(r, previous?.rows ?? []); const deficit = gap(r); const t = rowTotals.get(r.id);
                  const differs = !!t?.count && staffingTotalsDiffer(r, t);
                  return <Table.Tr key={r.id} data-selected={selectedVisible.includes(r.id) || undefined}>
                    {canEdit && <Table.Td><Checkbox aria-label={`Выбрать: ${r.department}`} checked={selectedVisible.includes(r.id)} onChange={e => { const checked = e.currentTarget.checked; setSelected(ids => checked ? [...ids, r.id] : ids.filter(id => id !== r.id)); }} /></Table.Td>}
                    <Table.Td><UnstyledButton className="staffing-department" onClick={() => setRow(r)}>{r.department}</UnstyledButton><Text size="xs" c="dimmed" lineClamp={1}>{staffingGroupOf(r)}{t?.count ? ` · должностей: ${t.count}` : ''}{r.note ? ` · ${r.note}` : ''}</Text>{differs && <Text size="xs" c="var(--status-warning)">△ По должностям: штат {n(t!.planned)}, факт {n(t!.actual)}</Text>}</Table.Td>
                    <Table.Td><Badge variant="light" color="gray" size="sm">{r.category}</Badge></Table.Td><Table.Td ta="right">{n(r.planned)}</Table.Td><Table.Td ta="right">{n(r.actual)}</Table.Td>
                    <Table.Td ta="right">{deficit === null ? <Badge variant="outline" color="gray" size="xs">Нет данных</Badge> : deficit > 0 ? <Text size="sm" c="var(--status-warning)" fw={600}>−{n(deficit)}</Text> : deficit < 0 ? <Tooltip label="Превышение штата"><Text size="sm">+{n(-deficit)}</Text></Tooltip> : '0'}</Table.Td>
                    <Table.Td ta="right"><Tooltip label={`К ${previous ? d(previous.asOf) : 'не выбранному периоду'}`}><span>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${n(delta)}`}</span></Tooltip></Table.Td>
                    <Table.Td><Menu position="bottom-end"><Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`Действия: ${r.department}`}><IconDots size={16} /></ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setRow(r)}>{canEdit ? 'Редактировать' : 'Открыть'}</Menu.Item><Menu.Item leftSection={<IconListDetails size={14} />} onClick={() => setRow(r, 'positions')}>Должности{t?.count ? ` (${t.count})` : ''}</Menu.Item>{canEdit && <Menu.Item color={r.isArchived ? undefined : 'red'} onClick={() => archiveRows([r.id], !r.isArchived)}>{r.isArchived ? 'Восстановить' : 'Архивировать'}</Menu.Item>}</Menu.Dropdown></Menu></Table.Td>
                  </Table.Tr>;
                })}</Table.Tbody>
                {filtered.length > 0 && <Table.Tfoot><Table.Tr>{canEdit && <Table.Td />}<Table.Td fw={600}>Итого по найденным</Table.Td><Table.Td /><Table.Td ta="right">{n(filteredStats.planned)}</Table.Td><Table.Td ta="right">{n(filteredStats.actual)}</Table.Td><Table.Td colSpan={3}><Text size="xs" c="dimmed">Суммы известных значений</Text></Table.Td></Table.Tr></Table.Tfoot>}
              </Table></Table.ScrollContainer>
              {!filtered.length && <Stack align="center" py="lg"><Text c="dimmed">{current.rows.length ? 'Подразделения не найдены' : 'В срезе пока нет подразделений'}</Text>{canEdit && !current.rows.length && <Button variant="default" onClick={() => setRow(emptyRow())}>Добавить подразделение</Button>}</Stack>}
              {filtered.length > 50 && <Pagination total={Math.ceil(filtered.length / 50)} value={page} onChange={setPage} />}
            </Stack>
          </Tabs.Panel>
          {showFinance && <Tabs.Panel value="payroll" pt="md"><Payroll years={data.payroll} canEdit={canEdit} canExport={data.canExport} onEdit={setPayrollForm} /></Tabs.Panel>}
          {data.canAudit && <Tabs.Panel value="journal" pt="md"><Journal /></Tabs.Panel>}
        </Tabs>
        <Text size="xs" c="dimmed" className="staffing-source">{current.note || 'Источник не указан'} · обновлено {new Date(current.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</Text>
      </>}
    </>}
    {editing && <RowEditor row={editing.row} period={editing.period} canEdit={canEdit} tab={editing.tab} onClose={() => setEditing(null)} onSave={value => savePeriod(value, undefined, editing.period)} />}
    {tableEdit && current && <RowsTableEditor period={current} rows={filtered} onClose={() => setTableEdit(false)} onSave={value => savePeriod(value)} />}
    {groupsForm && current && <GroupsDialog period={current} onClose={() => setGroupsForm(false)} onDone={refresh} />}
    {periodForm && <PeriodEditor initial={periodForm === 'edit' ? periodBase : undefined} periods={periods} onClose={() => setPeriodForm(null)} onSave={async value => { if (periodForm === 'edit') await savePeriod(value, undefined, periodBase); else { await api('/staffing/periods', { method: 'POST', body: value }); await refresh(); update({ month: value.month, archive: undefined }); } }} />}
    {editors && <EditorsDialog onClose={() => setEditors(false)} />}
    {payrollForm && <PayrollEditor initial={payrollForm === 'new' ? undefined : payrollForm} period={current} onClose={() => setPayrollForm(null)} onSave={async value => { await api(payrollForm === 'new' ? '/staffing/payroll' : `/staffing/payroll/${payrollForm.year}`, { method: payrollForm === 'new' ? 'POST' : 'PUT', body: payrollForm === 'new' ? value : { version: payrollForm.version, data: value } }); await refresh(); }} />}
    <Modal opened={!!confirm} onClose={() => { if (!busy) { setConfirm(null); setActionError(''); } }} title="Подтвердите действие"><Stack><Text size="sm">{confirm?.title}</Text>{actionError && <Alert color="red">{actionError}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setConfirm(null)}>Отмена</Button><Button loading={busy} onClick={() => confirm && runAction(confirm.action)}>Подтвердить</Button></Group></Stack></Modal>
  </Stack>;
}

function Overview({ periods, current, previous, open, measure, onMeasure, openGroup, editGroup, movements }: { periods: StaffingPeriod[]; current: StaffingPeriod; previous?: StaffingPeriod; open: (r: StaffingRow) => void; measure: Measure; onMeasure: (m: Measure) => void; openGroup: (group: string) => void; editGroup?: (group: string) => void; movements: StaffingMovementDay[] }) {
  const rows = current.rows.filter(r => !r.isArchived);
  const attention = rows.filter(r => r.planned == null || r.actual == null || gap(r) !== 0).sort((a, b) => (gap(b) ?? -1) - (gap(a) ?? -1));
  return <Stack gap="md">
      <Paper withBorder p="md"><Group justify="space-between" mb="sm"><Text size="sm" fw={600}>Численность по срезам</Text><Badge variant="outline" color="gray" size="sm">Суммы известных данных</Badge></Group>
        <EChart height={245} ariaLabel="Штат и факт на исходные даты срезов, суммы известных значений" option={c => ({ ...baseOption(c), tooltip: { trigger: 'axis', confine: true, valueFormatter: v => `${n(Number(v))}` }, xAxis: { type: 'category', data: periods.map(p => d(p.asOf)), axisLabel: { color: c.muted, fontSize: 11 } }, yAxis: { type: 'value', min: 0, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.grid } } }, series: [ { name: 'Штат, ед.', type: 'bar', data: periods.map(p => summarizeStaffing(p.rows).planned), itemStyle: { color: c.series[1], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 34 }, { name: 'Факт, чел.', type: 'bar', data: periods.map(p => summarizeStaffing(p.rows).actual), itemStyle: { color: c.series[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 34 } ] })} />
      </Paper>
    <GroupPie period={current} measure={measure} onMeasure={onMeasure} openGroup={openGroup} editGroup={editGroup} movements={movements} />
    <div><Group justify="space-between" mb="sm"><Group gap="xs"><Text size="sm" fw={600}>Требуют внимания</Text><Badge variant="light" color="gray" size="sm">{attention.length}</Badge></Group><Text size="xs" c="dimmed">{previous ? `Изменение к ${d(previous.asOf)}` : 'Нет предыдущего среза'}</Text></Group>
      <Table.ScrollContainer minWidth={650}><Table highlightOnHover verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>Подразделение</Table.Th><Table.Th ta="right">Штат</Table.Th><Table.Th ta="right">Факт</Table.Th><Table.Th>Состояние</Table.Th><Table.Th ta="right">Изм.</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{attention.map(r => <Table.Tr key={r.id}><Table.Td><UnstyledButton className="staffing-department" onClick={() => open(r)}>{r.department}</UnstyledButton></Table.Td><Table.Td ta="right">{n(r.planned)}</Table.Td><Table.Td ta="right">{n(r.actual)}</Table.Td><Table.Td><Badge variant="light" color={gap(r) == null ? 'gray' : 'orange'} size="sm">{gap(r) == null ? '△ Нет данных' : gap(r)! > 0 ? `Дефицит ${n(gap(r))}` : `Превышение ${n(-gap(r)!)}`}</Badge></Table.Td><Table.Td ta="right">{n(staffingDelta(r, previous?.rows ?? []))}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
      {!attention.length && <Text size="sm" c="dimmed" py="md">Отклонений и пропусков нет</Text>}
    </div>
  </Stack>;
}

function Payroll({ years, canEdit, canExport, onEdit }: { years: StaffingPayroll[]; canEdit: boolean; canExport: boolean; onEdit: (p: StaffingPayroll | 'new') => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const current = years.find(y => y.year === chosen) ?? years.at(-1);
  const rows = current?.rows.filter(r => r.department.toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru')) && (!category || r.category === category)) ?? [];
  const total = rows.some(r => r.amount !== null) ? rows.reduce((s, r) => s + (r.amount ?? 0), 0) : null;
  return <Stack gap="sm"><Group justify="space-between" align="end"><Group align="end"><Select label="Год" data={years.map(y => String(y.year))} value={current ? String(current.year) : null} onChange={v => setChosen(Number(v))} w={110} allowDeselect={false} /><div><Text size="xs" c="dimmed">{current?.label}</Text><Text size="xl" fw={600}>{n(total)} млн ₽</Text></div></Group>{canEdit && <Group gap="xs"><Button variant="default" size="sm" onClick={() => onEdit('new')}>Добавить год</Button>{current && <Button size="sm" onClick={() => onEdit(current)}>Редактировать ФОТ</Button>}</Group>}</Group>
    <Text size="xs" c="dimmed">{rows.filter(r => r.amount !== null).length} / {rows.length} заполнено · ФОТ по годам не суммируется с месячными срезами</Text>
    <Group className="staffing-controls"><TextInput placeholder="Поиск подразделения" aria-label="Поиск ФОТ" leftSection={<IconSearch size={16} />} value={q} onChange={e => setQ(e.currentTarget.value)} /><Select placeholder="Все категории" aria-label="Категория ФОТ" data={[...STAFFING_CATEGORIES]} value={category} onChange={setCategory} clearable />{canExport && current && <Button variant="subtle" size="xs" leftSection={<IconDownload size={14} />} onClick={() => download(`ФОТ ${current.year}.csv`, [['Год', 'Период', 'Подразделение', 'Категория', 'ФОТ, млн ₽'], ...rows.map(r => [current.year, current.label, r.department, r.category, r.amount])])}>Выгрузить</Button>}</Group>
    <Table.ScrollContainer minWidth={560}><Table highlightOnHover verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>Подразделение</Table.Th><Table.Th>Категория</Table.Th><Table.Th ta="right">ФОТ, млн ₽</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(r => <Table.Tr key={r.id}><Table.Td>{r.department}</Table.Td><Table.Td>{r.category}</Table.Td><Table.Td ta="right">{n(r.amount)}</Table.Td></Table.Tr>)}</Table.Tbody><Table.Tfoot><Table.Tr><Table.Td fw={600}>Итого по найденным</Table.Td><Table.Td /><Table.Td ta="right" fw={600}>{n(total)}</Table.Td></Table.Tr></Table.Tfoot></Table></Table.ScrollContainer>{!rows.length && <Text c="dimmed" size="sm">{years.length ? 'Подразделения не найдены' : 'Годовой ФОТ пока не добавлен'}</Text>}
  </Stack>;
}

function Journal() {
  const query = useQuery({ queryKey: ['staffing', 'journal'], queryFn: () => api<StaffingAuditItem[]>('/staffing/journal') });
  const [q, setQ] = useState('');
  if (query.error) return <Alert color="red">{query.error.message}<Button variant="subtle" onClick={() => query.refetch()}>Повторить</Button></Alert>;
  if (!query.data) return <Skeleton height={180} />;
  const key = q.trim().toLocaleLowerCase('ru');
  const rows = query.data.map(r => ({ ...r, text: r.comment ?? (r.action === 'CREATE' ? 'Создано' : 'Изменено') })).filter(r => !key || `${r.user} ${r.entityId} ${r.text}`.toLocaleLowerCase('ru').includes(key));
  return <Stack gap="sm"><Group justify="space-between" gap="xs"><Text size="xs" c="dimmed">Последние 300 изменений · время Москвы{key ? ` · найдено ${rows.length}` : ''}</Text><TextInput aria-label="Поиск в журнале" placeholder="Поиск: кто, период, изменение" leftSection={<IconSearch size={15} />} value={q} onChange={e => setQ(e.currentTarget.value)} w={280} maw="100%" /></Group><Table.ScrollContainer minWidth={600}><Table verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>Когда</Table.Th><Table.Th>Кто</Table.Th><Table.Th>Период</Table.Th><Table.Th>Изменение</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(r => <Table.Tr key={r.id}><Table.Td className="staffing-nowrap">{new Date(r.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</Table.Td><Table.Td>{r.user}</Table.Td><Table.Td className="staffing-nowrap">{r.entityId}</Table.Td><Table.Td className="staffing-journal-change">{r.text}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>{!rows.length && <Text c="dimmed">{key ? 'Ничего не найдено' : 'Изменений пока нет'}</Text>}</Stack>;
}
