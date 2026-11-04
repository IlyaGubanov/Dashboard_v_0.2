/**
 * «Распределение по РСУ и подразделениям»: диаграмма + таблица групп, линии связи между сектором и строкой,
 * раскрытие группы — должности (план / факт / потребность) и приём/увольнение за последние 4 недели.
 * На широком экране — полукольцо, повёрнутое к таблице (секторы и строки идут в одном порядке, линии не пересекаются);
 * на узком — полное кольцо над таблицей, без линий.
 */
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Paper, SegmentedControl, Table, Text, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconEdit, IconListDetails } from '@tabler/icons-react';
import type { EChartsOption } from 'echarts';
import { STAFFING_GROUP_OTHER, staffingActivePositions, staffingGroupPositions, staffingGroups, staffingMovementByGroup, type StaffingMovementDay, type StaffingPeriod } from '@mvs/shared';
import { EChart, baseOption, type ChartColors } from '../../ui/EChart';

export type Measure = 'actual' | 'planned';
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const d = (v: string) => v.split('-').reverse().join('.');
const pct = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
const shift = (date: string, days: number) => { const x = new Date(`${date}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };

/** Десять тонов --cat-1…10 по убыванию факта; «АУП» и группы после десятой — нейтральный --status-none. */
function toneOf(groups: { group: string }[], group: string): number | null {
  const i = groups.filter(g => g.group !== STAFFING_GROUP_OTHER).findIndex(g => g.group === group);
  return group !== STAFFING_GROUP_OTHER && i < 10 ? i : null;
}
const toneVar = (t: number | null) => t == null ? 'var(--status-none)' : `var(--cat-${t + 1})`;

interface Line { group: string; color: string; points: string; x0: number; y0: number; x1: number; y1: number }
const CHART_H = 460;

export function GroupPie({ period, measure, onMeasure, openGroup, editGroup, movements }: { period: StaffingPeriod; measure: Measure; onMeasure: (m: Measure) => void; openGroup: (group: string) => void; editGroup?: (group: string) => void; movements: StaffingMovementDay[] }) {
  const wide = useMediaQuery('(min-width: 62em)') ?? false;
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => staffingGroups(period.rows), [period]);
  const unit = measure === 'actual' ? 'чел.' : 'ед.';
  const value = (g: (typeof groups)[number]) => g[measure];
  const gaps = (g: (typeof groups)[number]) => measure === 'actual' ? g.missingActual : g.missingPlan;
  // список секторов запоминается: от него зависит пересчёт линий, новый массив на каждой отрисовке зациклил бы обновления
  const known = useMemo(() => groups.filter(g => (g[measure] ?? 0) > 0), [groups, measure]);
  const total = known.reduce((s, g) => s + value(g)!, 0);
  const missing = groups.reduce((s, g) => s + gaps(g), 0);
  const share = (v: number | null) => v == null || !total ? '—' : pct(v / total * 100);
  const toggle = (group: string) => setExpanded(e => e === group ? null : group);

  // геометрия: размеры области графика и строк таблицы → линии связи
  const wrap = useRef<HTMLDivElement>(null);
  const chartBox = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [size, setSize] = useState({ w: 0, h: CHART_H });
  const [lines, setLines] = useState<Line[]>([]);
  const R = wide ? Math.max(80, Math.min(size.w * 0.68, size.h / 2 - 14)) : 0;
  const cx = 22, cy = size.h / 2;

  useLayoutEffect(() => {
    if (!wide || !wrap.current || !chartBox.current) { setLines(prev => prev.length ? [] : prev); return; }
    const measureAll = () => {
      const w = wrap.current!.getBoundingClientRect(), c = chartBox.current!.getBoundingClientRect();
      setSize(s => s.w === c.width && s.h === c.height ? s : { w: c.width, h: c.height });
      const r = Math.max(80, Math.min(c.width * 0.68, c.height / 2 - 14));
      const ox = c.left - w.left, oy = c.top - w.top, ccy = c.height / 2;
      let cum = 0;
      const next: Line[] = [];
      for (const g of known) {
        const f = value(g)! / total;
        const theta = (90 - 180 * (cum + f / 2)) * Math.PI / 180;
        cum += f;
        const row = rowRefs.current.get(g.group);
        if (!row) continue;
        const rr = row.getBoundingClientRect();
        const x0 = ox + cx + r * Math.cos(theta), y0 = oy + ccy - r * Math.sin(theta);
        const x1 = rr.left - w.left - 4, y1 = rr.top - w.top + Math.min(rr.height, 44) / 2;
        const bend = ox + cx + r + 14;
        next.push({ group: g.group, color: toneVar(toneOf(groups, g.group)), x0, y0, x1, y1, points: `${x0},${y0} ${Math.max(bend, x0 + 6)},${y0} ${x1 - 14},${y1} ${x1},${y1}` });
      }
      setLines(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    measureAll();
    const ro = new ResizeObserver(measureAll);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [wide, known, total, expanded, measure]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = useCallback((c: ChartColors): EChartsOption => {
    const base = baseOption(c);
    const half = wide && size.w > 0;
    return {
      ...base,
      legend: { show: false },
      tooltip: { ...(base.tooltip as object), trigger: 'item', formatter: (p: unknown) => { const x = p as { name: string; value: number; percent: number }; return `${x.name}<br/>${n(x.value)} ${unit} · ${pct(x.value / total * 100)}`; } },
      title: half ? undefined : { text: n(total), subtext: `${unit} всего`, left: 'center', top: 'middle', itemGap: 2, textStyle: { color: c.text, fontSize: Math.round(c.fontSize * 1.7), fontWeight: 600 }, subtextStyle: { color: c.muted, fontSize: c.fontSize } },
      series: [{
        type: 'pie', minAngle: 0, avoidLabelOverlap: false, selectedMode: 'single', selectedOffset: 10,
        ...(half ? { center: [cx, cy], radius: [R * 0.5, R], startAngle: 90, endAngle: -90, clockwise: true } : { center: ['50%', '50%'], radius: ['55%', '90%'] }),
        itemStyle: { borderColor: c.surface, borderWidth: 2 },
        label: { position: 'inside', fontSize: Math.round(c.fontSize * 1.1), fontWeight: 700, formatter: (p: unknown) => { const x = p as { value: number }; const s = x.value / total * 100; return s >= (half ? 3 : 5) ? `${Math.round(s)}%` : ''; } },
        emphasis: { scaleSize: 6 },
        data: known.map(g => {
          const t = toneOf(groups, g.group);
          return { name: g.group, value: value(g)!, selected: g.group === expanded, itemStyle: { color: t == null ? c.none : c.cat[t] }, label: { color: t == null ? c.surface : c.catInk[t] } };
        }),
      }],
    };
  }, [known, groups, total, unit, wide, size.w, R, cy, expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // приём/увольнение группы за последние 28 дней внесённых данных
  const lastDay = movements.at(-1)?.date;
  const recent = useMemo(() => lastDay ? Object.fromEntries(staffingMovementByGroup(movements, shift(lastDay, -27), lastDay).map(g => [g.group, g])) : {}, [movements, lastDay]);

  return <Paper withBorder p="md">
    <Group justify="space-between" mb="sm" gap="xs">
      <div><Text fw={650} className="staffing-block-title">Распределение по РСУ и подразделениям</Text><Text size="sm" c="dimmed">Доля от общей численности на {d(period.asOf)} · групп: {groups.length}</Text></div>
      <SegmentedControl value={measure} onChange={v => onMeasure(v as Measure)} data={[{ value: 'actual', label: 'Факт, чел.' }, { value: 'planned', label: 'Штат, ед.' }]} aria-label="Показатель диаграммы" />
    </Group>
    {!known.length ? <Text c="dimmed" py="lg" ta="center">△ {measure === 'planned' ? 'Штат по подразделениям в этом срезе не заполнен' : 'Факт в этом срезе не заполнен'}</Text> :
      <div ref={wrap} className="staffing-pie-wrap" data-wide={wide || undefined}>
        <div className="staffing-pie-grid">
          <div ref={chartBox} className="staffing-pie-chart" style={{ height: wide ? CHART_H : 320 }}>
            <EChart height={wide ? CHART_H : 320} option={option} onClick={p => toggle(p.name)} ariaLabel={`Распределение, ${unit}: ${known.map(g => `${g.group} — ${share(value(g))}`).join(', ')}`} />
            {wide && size.w > 0 && <div className="staffing-pie-total" style={{ left: cx + R * 0.1, top: cy }}><div className="staffing-pie-total-value">{n(total)}</div><div className="staffing-pie-total-unit">{unit} всего</div></div>}
          </div>
          <Table.ScrollContainer minWidth={320}><Table verticalSpacing={8} highlightOnHover className="staffing-table staffing-groups-table">
            <Table.Thead><Table.Tr><Table.Th>Группа</Table.Th><Table.Th ta="right">{measure === 'actual' ? 'Факт' : 'Штат'}, {unit}</Table.Th><Table.Th ta="right">Доля</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{groups.map(g => {
              const open = expanded === g.group;
              return <Fragment key={g.group}>
                <Table.Tr ref={el => { if (el) rowRefs.current.set(g.group, el); else rowRefs.current.delete(g.group); }} data-open={open || undefined}>
                  <Table.Td><UnstyledButton className="staffing-group" onClick={() => toggle(g.group)} aria-expanded={open}>
                    <span className="staffing-swatch" style={{ background: toneVar(toneOf(groups, g.group)) }} aria-hidden />
                    <span>{g.group}</span>{open ? <IconChevronDown size={16} className="staffing-chevron" /> : <IconChevronRight size={16} className="staffing-chevron" />}
                  </UnstyledButton>
                    {(g.count > 1 || gaps(g) > 0) && <Text size="sm" c="dimmed" ml={22}>подразделений: {g.count}{gaps(g) ? ` · △ без данных: ${gaps(g)}` : ''}</Text>}</Table.Td>
                  <Table.Td ta="right" className="staffing-nowrap">{n(value(g))}</Table.Td><Table.Td ta="right" c="dimmed" className="staffing-nowrap">{share(value(g))}</Table.Td>
                </Table.Tr>
                {open && <Table.Tr className="staffing-group-details"><Table.Td colSpan={3}><GroupDetails period={period} group={g.group} movement={recent[g.group]} lastDay={lastDay} openGroup={openGroup} editGroup={editGroup} /></Table.Td></Table.Tr>}
              </Fragment>;
            })}</Table.Tbody>
            <Table.Tfoot><Table.Tr><Table.Td fw={650}>Итого</Table.Td><Table.Td ta="right" fw={650} className="staffing-nowrap">{n(total)}</Table.Td><Table.Td ta="right" c="dimmed" className="staffing-nowrap">100 %</Table.Td></Table.Tr></Table.Tfoot>
          </Table></Table.ScrollContainer>
        </div>
        {wide && <svg className="staffing-pie-lines" aria-hidden>{lines.map(l => <g key={l.group} stroke={l.color} fill={l.color} opacity={expanded && expanded !== l.group ? 0.25 : 0.9}>
          <polyline points={l.points} fill="none" strokeWidth={expanded === l.group ? 2.5 : 1.5} strokeLinejoin="round" />
          <circle cx={l.x0} cy={l.y0} r={3} /><circle cx={l.x1} cy={l.y1} r={3} />
        </g>)}</svg>}
      </div>}
    <Text size="sm" c="dimmed" mt="xs">{missing ? `△ Без данных: ${missing} подразд. — доли считаются от известной суммы. ` : ''}Нажмите на группу или сектор — откроется список должностей: план, факт, потребность.</Text>
  </Paper>;
}

/** Раскрытая группа: должности (план = факт + вакансии) и приём/увольнение за 4 недели. */
function GroupDetails({ period, group, movement, lastDay, openGroup, editGroup }: { period: StaffingPeriod; group: string; movement?: { hired: number; dismissed: number; net: number }; lastDay?: string; openGroup: (group: string) => void; editGroup?: (group: string) => void }) {
  const [all, setAll] = useState(false);
  const pos = staffingGroupPositions(staffingActivePositions(period), group);
  const shown = all ? pos.items : pos.items.slice(0, 12);
  return <div className="staffing-details">
    <Group gap="lg" mb="xs" wrap="wrap">
      <Text size="sm"><b>План:</b> {n(pos.planned)} ед.</Text><Text size="sm"><b>Факт:</b> {n(pos.actual)} чел.</Text>
      <Text size="sm" c={(pos.need ?? 0) > 0 ? 'var(--status-warning)' : undefined}><b>Потребность:</b> {(pos.need ?? 0) > 0 ? '△ ' : ''}{n(pos.need)}</Text>
      {movement && lastDay && <Text size="sm"><b>За 4 недели до {d(lastDay)}:</b> принято {movement.hired}, уволено {movement.dismissed} (сальдо {movement.net > 0 ? '+' : ''}{movement.net})</Text>}
    </Group>
    {!pos.items.length ? <Text size="sm" c="dimmed">Должности для этого среза не загружены.</Text> : <>
      <Table.ScrollContainer minWidth={420}><Table verticalSpacing={4} className="staffing-positions">
        <Table.Thead><Table.Tr><Table.Th>Должность</Table.Th><Table.Th ta="right">План</Table.Th><Table.Th ta="right">Факт</Table.Th><Table.Th ta="right">Потребность</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{shown.map(p => <Table.Tr key={p.id}><Table.Td>{p.title}</Table.Td><Table.Td ta="right">{n(p.planned)}</Table.Td><Table.Td ta="right">{n(p.actual)}</Table.Td>
          <Table.Td ta="right">{p.need == null ? '—' : p.need > 0 ? <Text span size="sm" fw={650} c="var(--status-warning)">△ {n(p.need)}</Text> : '0'}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>
      {pos.planned == null && <Text size="xs" c="dimmed" mt={4}>План по должностям этой группы в источнике не указан — показан только факт.</Text>}
    </>}
    <Group gap="xs" mt="xs">
      {pos.items.length > 12 && <Button size="xs" variant="subtle" onClick={() => setAll(a => !a)}>{all ? 'Свернуть' : `Показать все должности (${pos.items.length})`}</Button>}
      <Button size="xs" variant="default" leftSection={<IconListDetails size={14} />} onClick={() => openGroup(group)}>Подразделения группы</Button>
      {editGroup && <Button size="xs" variant="default" leftSection={<IconEdit size={14} />} onClick={() => editGroup(group)}>Редактировать должности</Button>}
    </Group>
  </div>;
}
