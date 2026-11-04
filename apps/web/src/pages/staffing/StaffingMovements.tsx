/** Вкладка «Приём и увольнение»: график по дням/неделям/месяцам, итоги по группам, ввод за день (как лист «Приемыувольнения»). */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight, IconPlus, IconScale } from '@tabler/icons-react';
import type { EChartsOption } from 'echarts';
import { staffingMovementByGroup, staffingMovementDaySchema, staffingMovementSeries, type StaffingMovementDay, type StaffingMovementMode } from '@mvs/shared';
import { api } from '../../api';
import { EChart, baseOption, type ChartColors } from '../../ui/EChart';

const d = (v: string) => v.split('-').reverse().join('.');
const dm = (v: string) => `${v.slice(8, 10)}.${v.slice(5, 7)}`;
const shift = (date: string, days: number) => { const x = new Date(`${date}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
const todayMsk = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString('ru-RU')}`;
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const label = (start: string, mode: StaffingMovementMode) => mode === 'day' ? dm(start) : mode === 'week' ? `${dm(start)}–${dm(shift(start, 6))}` : `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;

function Tile({ label: title, value, hint, tone, icon }: { label: string; value: string; hint: string; tone: number; icon: React.ReactNode }) {
  return <Paper withBorder p="md" className="staffing-stat" style={{ '--stat-tone': `var(--cat-${tone})`, '--stat-ink': `var(--cat-ink-${tone})` } as React.CSSProperties}>
    <Group gap="xs" wrap="nowrap" justify="space-between" align="flex-start"><Text size="sm" fw={600} className="staffing-stat-label">{title}</Text><span className="staffing-stat-icon" aria-hidden>{icon}</span></Group>
    <Text className="staffing-stat-value" fw={650}>{value}</Text><Text size="xs" c="dimmed">{hint}</Text>
  </Paper>;
}

export function MovementsTab({ days, groups, canEdit, onSaved }: { days: StaffingMovementDay[]; groups: string[]; canEdit: boolean; onSaved: () => Promise<void> }) {
  const last = days.at(-1)?.date ?? todayMsk();
  const [mode, setMode] = useState<StaffingMovementMode>('week');
  const [group, setGroup] = useState<string | null>(null);
  // по умолчанию — последние 8 недель, но не раньше первого внесённого дня
  const [from, setFrom] = useState(() => [shift(last, -55), days[0]?.date ?? ''].sort().at(-1)!);
  const [to, setTo] = useState(last);
  const [editing, setEditing] = useState<string | null>(null);
  const allGroups = useMemo(() => [...new Set([...groups, ...days.flatMap(x => x.rows.map(r => r.group))])], [groups, days]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const series = useMemo(() => valid ? staffingMovementSeries(days, mode, from, to, group ?? undefined) : [], [days, mode, from, to, group, valid]);
  const byGroup = useMemo(() => valid ? staffingMovementByGroup(days, from, to) : [], [days, from, to, valid]);
  const hired = series.reduce((s, b) => s + b.hired, 0), dismissed = series.reduce((s, b) => s + b.dismissed, 0);
  const daysIn = days.filter(x => x.date >= from && x.date <= to).length;
  const span = valid ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 : 0;

  const option = useCallback((c: ChartColors): EChartsOption => ({
    ...baseOption(c),
    grid: { left: 12, right: 20, top: 42, bottom: 12, containLabel: true },
    tooltip: { ...(baseOption(c).tooltip as object), trigger: 'axis', valueFormatter: v => Math.abs(Number(v)).toLocaleString('ru-RU') },
    xAxis: { type: 'category', data: series.map(b => label(b.start, mode)), axisLabel: { color: c.muted, fontSize: c.fontSize, hideOverlap: true }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: c.muted, formatter: (v: number) => Math.abs(v).toLocaleString('ru-RU') }, splitLine: { lineStyle: { color: c.grid } } },
    series: [
      { name: 'Принято', type: 'bar', stack: 'move', data: series.map(b => b.hired), itemStyle: { color: c.cat[2], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 34, label: { show: mode !== 'day', position: 'top', color: c.text, formatter: (p: unknown) => (p as { value: number }).value ? String((p as { value: number }).value) : '' } },
      { name: 'Уволено', type: 'bar', stack: 'move', data: series.map(b => -b.dismissed), itemStyle: { color: c.cat[1], borderRadius: [0, 0, 4, 4] }, barMaxWidth: 34, label: { show: mode !== 'day', position: 'bottom', color: c.text, formatter: (p: unknown) => (p as { value: number }).value ? String(-(p as { value: number }).value) : '' } },
      { name: 'Сальдо', type: 'line', data: series.map(b => b.hired - b.dismissed), itemStyle: { color: c.cat[0] }, lineStyle: { width: 2.5 }, symbolSize: 7, z: 5 },
    ],
  }), [series, mode]);

  return <Stack gap="md">
    <Group gap="sm" align="flex-end" className="staffing-controls">
      <SegmentedControl value={mode} onChange={v => setMode(v as StaffingMovementMode)} data={[{ value: 'day', label: 'Дни' }, { value: 'week', label: 'Недели' }, { value: 'month', label: 'Месяцы' }]} aria-label="Период группировки" />
      <Select label="Группа" placeholder="Все группы" data={allGroups} value={group} onChange={setGroup} clearable searchable w={240} comboboxProps={{ zIndex: 1000 }} />
      <TextInput type="date" label="С" value={from} onChange={e => setFrom(e.currentTarget.value)} w={140} error={!valid ? ' ' : undefined} />
      <TextInput type="date" label="По" value={to} onChange={e => setTo(e.currentTarget.value)} w={140} error={!valid ? ' ' : undefined} />
      {canEdit && <Button ml="auto" leftSection={<IconPlus size={16} />} onClick={() => setEditing(shift(todayMsk(), -1))}>Внести за день</Button>}
    </Group>
    {!valid && <Text size="sm" c="var(--status-warning)">△ Дата «С» должна быть не позже даты «По»</Text>}
    {!days.length ? <Paper withBorder p="xl"><Text ta="center" c="dimmed">Данных о приёме и увольнении пока нет. {canEdit ? 'Нажмите «Внести за день» или загрузите исходные данные в меню раздела.' : ''}</Text></Paper> : <>
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
        <Tile tone={3} icon={<IconArrowUpRight size={20} />} label="Принято" value={`${hired.toLocaleString('ru-RU')} чел.`} hint={`${group ?? 'все группы'} · ${d(from)}–${d(to)}`} />
        <Tile tone={2} icon={<IconArrowDownRight size={20} />} label="Уволено" value={`${dismissed.toLocaleString('ru-RU')} чел.`} hint={`дней с данными: ${daysIn} из ${span}`} />
        <Tile tone={1} icon={<IconScale size={20} />} label="Сальдо" value={signed(hired - dismissed)} hint={hired - dismissed >= 0 ? 'приняли больше, чем уволили' : 'уволили больше, чем приняли'} />
      </SimpleGrid>
      <Paper withBorder p="md">
        <Group justify="space-between" mb={4}><Text fw={650} className="staffing-block-title">Приём и увольнение {mode === 'day' ? 'по дням' : mode === 'week' ? 'по неделям' : 'по месяцам'}</Text><Text size="sm" c="dimmed">{group ?? 'Все группы'}</Text></Group>
        <Text size="xs" c="dimmed" mb="xs">Столбик вверх — принято, вниз — уволено, линия — сальдо. Переводы между управлениями учтены как приём и увольнение, как в исходной таблице.</Text>
        <EChart height={320} option={option} ariaLabel={`Приём и увольнение: принято ${hired}, уволено ${dismissed}`} />
      </Paper>
      <Paper withBorder p="md">
        <Text fw={650} className="staffing-block-title" mb="xs">По группам за {d(from)}–{d(to)}</Text>
        <Table.ScrollContainer minWidth={420}><Table highlightOnHover verticalSpacing={8} className="staffing-table staffing-groups-table">
          <Table.Thead><Table.Tr><Table.Th>Группа</Table.Th><Table.Th ta="right">Принято</Table.Th><Table.Th ta="right">Уволено</Table.Th><Table.Th ta="right">Сальдо</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{byGroup.map(g => <Table.Tr key={g.group} data-open={g.group === group || undefined}>
            <Table.Td><UnstyledButton className="staffing-department" onClick={() => setGroup(x => x === g.group ? null : g.group)}>{g.group}</UnstyledButton></Table.Td>
            <Table.Td ta="right">{g.hired}</Table.Td><Table.Td ta="right">{g.dismissed}</Table.Td>
            <Table.Td ta="right" fw={600}>{g.net > 0 ? '▲ ' : g.net < 0 ? '▼ ' : ''}{signed(g.net)}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
          <Table.Tfoot><Table.Tr><Table.Td fw={650}>Итого</Table.Td><Table.Td ta="right" fw={650}>{byGroup.reduce((s, g) => s + g.hired, 0)}</Table.Td><Table.Td ta="right" fw={650}>{byGroup.reduce((s, g) => s + g.dismissed, 0)}</Table.Td><Table.Td ta="right" fw={650}>{signed(byGroup.reduce((s, g) => s + g.net, 0))}</Table.Td></Table.Tr></Table.Tfoot>
        </Table></Table.ScrollContainer>
        <Text size="xs" c="dimmed" mt="xs">Нажмите на группу, чтобы показать на графике только её.</Text>
      </Paper>
    </>}
    {editing && <MovementEditor date={editing} days={days} groups={allGroups} onClose={() => setEditing(null)} onSaved={onSaved} />}
  </Stack>;
}

/** Ввод за день: таблица групп «принято / уволено». Если день уже внесён — правка с проверкой версии (409 при чужой правке). */
function MovementEditor({ date: initialDate, days, groups, onClose, onSaved }: { date: string; days: StaffingMovementDay[]; groups: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(initialDate);
  const existing = days.find(x => x.date === date);
  const [values, setValues] = useState<Record<string, Record<string, { hired: number | ''; dismissed: number | '' }>>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rowsFor = (g: string) => values[date]?.[g] ?? { hired: existing?.rows.find(r => r.group === g)?.hired ?? '', dismissed: existing?.rows.find(r => r.group === g)?.dismissed ?? '' };
  const set = (g: string, k: 'hired' | 'dismissed', v: number | '') => setValues(s => ({ ...s, [date]: { ...s[date], [g]: { ...rowsFor(g), [k]: v } } }));
  async function save() {
    const data = { date, note: note[date] ?? existing?.note ?? '', rows: groups.map(g => ({ group: g, hired: Number(rowsFor(g).hired || 0), dismissed: Number(rowsFor(g).dismissed || 0) })) };
    const parsed = staffingMovementDaySchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join('. ')); return; }
    setBusy(true); setError('');
    try { await api(`/staffing/movements/${date}`, { method: 'PUT', body: { version: existing?.version, data: parsed.data } }); await onSaved(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} title="Приём и увольнение за день" size="lg" zIndex={400}>
    <Stack gap="sm">
      <Group align="flex-end"><TextInput type="date" label="Дата" value={date} onChange={e => { setDate(e.currentTarget.value); setError(''); }} w={170} />
        <Text size="sm" c={existing ? 'var(--status-warning)' : 'dimmed'} mb={8}>{existing ? '△ За этот день данные уже внесены — сохранение изменит их' : 'Новый день: пустое поле — 0'}</Text></Group>
      <Table.ScrollContainer minWidth={420} maxHeight={420} scrollAreaProps={{ type: 'auto' }}><Table verticalSpacing={4} stickyHeader>
        <Table.Thead><Table.Tr><Table.Th>Группа</Table.Th><Table.Th w={110}>Принято</Table.Th><Table.Th w={110}>Уволено</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{groups.map(g => <Table.Tr key={g}><Table.Td><Text size="sm">{g}</Text></Table.Td>
          <Table.Td><NumberInput aria-label={`Принято: ${g}`} value={rowsFor(g).hired} min={0} allowDecimal={false} allowNegative={false} onChange={v => set(g, 'hired', v === '' ? '' : Number(v))} /></Table.Td>
          <Table.Td><NumberInput aria-label={`Уволено: ${g}`} value={rowsFor(g).dismissed} min={0} allowDecimal={false} allowNegative={false} onChange={v => set(g, 'dismissed', v === '' ? '' : Number(v))} /></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>
      <Textarea label="Примечание (переводы, источник найма)" value={note[date] ?? existing?.note ?? ''} onChange={e => { const v = e.currentTarget.value; setNote(s => ({ ...s, [date]: v })); }} maxLength={2000} autosize minRows={2} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={save}>Сохранить день</Button></Group>
    </Stack>
  </Modal>;
}
