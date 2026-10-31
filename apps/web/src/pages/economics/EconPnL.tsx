import { Fragment, useMemo } from 'react';
import { Alert, Button, Group, Paper, Select, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconDownload } from '@tabler/icons-react';
import { econDefaultMonth, econIsCompanyKind, econMonthLabel, econStatus, type EconSetup } from '@mvs/shared';
import { economicsOverviewQuery } from '../../api';
import { date, pct } from '../../ui/format';
import { analyse, pnl, sumPnl, type PnL } from './analysis';
import { STATUS_VAR, downloadCsv, rub, qty } from './format';
import type { EconomicsSearch } from './search';

/** Строка отчёта: план, факт и знак «хорошо» (+1 — больше факт лучше, −1 — меньше факт лучше, 0 — без отклонения). */
interface Line {
  key: string;
  label: string;
  level: 0 | 1 | 2;
  get: (p: PnL) => { plan: number | null; fact: number | null };
  good: 1 | -1 | 0;
  kind?: 'money' | 'pct' | 'hours';
  bold?: boolean;
  hint?: string;
}

const ratio = (a: number | null, b: number | null) => (a == null || !b ? null : a / b);

function lines(data: EconSetup): Line[] {
  const direct = data.articles.filter((a) => !econIsCompanyKind(a.kind));
  const company = data.articles.filter((a) => econIsCompanyKind(a.kind));
  return [
    { key: 'rev', label: 'Выручка (КС-2 + НЗП)', level: 0, bold: true, good: 1, get: (p) => ({ plan: p.revenuePlan, fact: p.revenue }), hint: 'План — стоимость без НДС × готовность (выполненный объём). Факт — КС-2 + НЗП: отличается от плана поправками НЗП и КС-2 сверх выполнения.' },
    { key: 'ks', label: 'КС-2', level: 1, good: 0, get: (p) => ({ plan: null, fact: p.ks }), hint: 'Нарастающим итогом без НДС: из дашборда или внесённые ПЭО.' },
    { key: 'nzp', label: 'НЗП', level: 1, good: 0, get: (p) => ({ plan: null, fact: p.nzp }), hint: 'Незавершённое производство: выполнено, но не закрыто КС-2 (с поправками ПЭО).' },
    { key: 'sched', label: 'Выручка по графику работ', level: 1, good: 1, get: (p) => ({ plan: p.revenueSchedule, fact: p.revenue }), hint: 'Стоимость × готовность по графику: отклонение показывает, сколько выручки не добрано из-за отставания от графика.' },
    { key: 'dir-h', label: 'Прямые расходы', level: 0, good: -1, bold: true, get: (p) => ({ plan: p.directPlan, fact: p.directFact }), hint: 'План — лимит × готовность. Плюс в отклонении — экономия, минус — перерасход.' },
    ...direct.map<Line>((a) => ({ key: `d${a.id}`, label: a.name, level: 1, good: -1, get: (p) => p.direct.get(a.id) ?? { plan: null, fact: null } })),
    { key: 'mp', label: 'Маржинальная прибыль', level: 0, bold: true, good: 1, get: (p) => ({ plan: p.marginPlan, fact: p.margin }) },
    { key: 'mp%', label: 'Рентабельность маржинальная', level: 1, good: 1, kind: 'pct', get: (p) => ({ plan: ratio(p.marginPlan, p.revenuePlan), fact: ratio(p.margin, p.revenue) }) },
    ...company.map<Line>((a) => ({ key: `c${a.id}`, label: a.name, level: 0, good: -1, get: (p) => p.company.get(a.id) ?? { plan: null, fact: null }, hint: 'Факт — общие расходы компании нарастающим итогом, разнесённые по доле выручки центра затрат в производственной программе.' })),
    { key: 'op', label: 'Операционная прибыль', level: 0, bold: true, good: 1, get: (p) => ({ plan: p.profitPlan, fact: p.profit }) },
    { key: 'op%', label: 'Рентабельность операционная', level: 1, good: 1, kind: 'pct', get: (p) => ({ plan: ratio(p.profitPlan, p.revenuePlan), fact: ratio(p.profit, p.revenue) }) },
    { key: 'lh', label: 'Трудочасы, чел.-ч', level: 0, good: -1, kind: 'hours', get: (p) => ({ plan: p.laborPlan, fact: p.labor }), hint: 'План — норма × готовность.' },
    { key: 'mh', label: 'Машино-часы, маш.-ч', level: 0, good: -1, kind: 'hours', get: (p) => ({ plan: p.machinePlan, fact: p.machine }) },
  ];
}

const fmt = (v: number | null, kind: Line['kind']) => (kind === 'pct' ? pct(v) : kind === 'hours' ? qty(v == null ? null : Math.round(v)) : rub(v));

function Dev({ line, plan, fact }: { line: Line; plan: number | null; fact: number | null }) {
  if (line.good === 0 || plan == null || fact == null) return <Text span c="dimmed">—</Text>;
  const d = line.good === 1 ? fact - plan : plan - fact;
  if (line.kind === 'pct') {
    const pp = d * 100;
    const status = pp >= -0.05 ? 'good' : pp >= -2 ? 'warning' : 'critical';
    return <Text span c={STATUS_VAR[status]} fw={500}>{`${pp > 0.05 ? '+' : pp < -0.05 ? '−' : ''}${Math.abs(pp).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} п.п.`}</Text>;
  }
  const rel = plan ? d / Math.abs(plan) : null;
  const status = econStatus(rel);
  const text = line.kind === 'hours' ? qty(Math.round(Math.abs(d))) : rub(Math.abs(d));
  return (
    <Tooltip label={`${d >= 0 ? 'Лучше' : 'Хуже'} плана на ${rel == null ? '—' : `${Math.abs(rel * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`}`}>
      <Text span c={STATUS_VAR[status]} fw={500}>{d > 0.5 ? '+' : d < -0.5 ? '−' : ''}{text}</Text>
    </Tooltip>
  );
}

export function EconPnL({ data, search, update }: { data: EconSetup; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }) {
  const withRows = data.months.filter((m) => m.rows > 0).map((m) => m.month);
  const month = search.month ?? withRows[0] ?? econDefaultMonth();
  const query = useQuery(economicsOverviewQuery(month, search.dir));
  const rows = useMemo(() => lines(data), [data]);
  const budgets = data.budgets.filter((b) => !b.isArchived && (!search.dir || b.directionId === search.dir) && query.data?.budgets.some((x) => x.budgetId === b.id));
  const units = useMemo(() => {
    if (!query.data) return [];
    // без готовности работ на конец месяца нет плана на выполненный объём — такие центры в сравнение не входят
    const all = budgets.map((b) => ({ b, a: analyse(b, data.articles, query.data) })).filter((x) => x.a.progress != null).map((x) => ({ b: x.b, p: pnl(x.a, data.articles, query.data) }));
    const dirs = data.directions.filter((d) => all.some((x) => x.b.directionId === d.id));
    if (search.dir) {
      const d = dirs[0];
      return [{ key: 'dir', title: d?.shortName ?? 'Направление', total: true, p: sumPnl(all.map((x) => x.p)) }, ...all.map((x) => ({ key: `b${x.b.id}`, title: x.b.title, total: false, p: x.p }))];
    }
    return [
      { key: 'all', title: 'Производственная программа', total: true, p: sumPnl(all.map((x) => x.p)) },
      ...dirs.map((d) => ({ key: `d${d.id}`, title: d.shortName, total: false, dirId: d.id, p: sumPnl(all.filter((x) => x.b.directionId === d.id).map((x) => x.p)) })),
    ];
  }, [budgets, data, query.data, search.dir]);
  const skipped = query.data ? budgets.filter((b) => analyse(b, data.articles, query.data).progress == null) : [];
  const choices = [...new Set([...withRows, month])].sort().reverse();

  function exportCsv() {
    downloadCsv(`Доходы и расходы ${econMonthLabel(month)}.csv`, [
      ['Статья', ...units.flatMap((u) => [`${u.title}: план`, `${u.title}: факт`])],
      ...rows.map((l) => [l.label, ...units.flatMap((u) => { const v = l.get(u.p); return l.kind === 'pct' ? [v.plan == null ? null : Math.round(v.plan * 1000) / 10, v.fact == null ? null : Math.round(v.fact * 1000) / 10] : [v.plan, v.fact]; })]),
    ]);
  }

  if (!data.budgets.length) return <Alert color="gray">Центров затрат пока нет. Задайте лимиты на вкладке «Лимиты».</Alert>;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" gap="sm">
        <Group gap="sm" align="flex-end">
          <Select label="Направление" w={220} data={[{ value: '', label: 'Все направления' }, ...data.directions.map((d) => ({ value: String(d.id), label: d.shortName }))]} value={search.dir ? String(search.dir) : ''} onChange={(v) => update({ dir: v ? Number(v) : undefined })} allowDeselect={false} />
          <Select label="Нарастающим итогом по" w={220} data={choices.map((m) => ({ value: m, label: econMonthLabel(m) }))} value={month} onChange={(v) => v && update({ month: v })} allowDeselect={false} />
        </Group>
        {data.canExport && units.length > 0 && <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv}>Выгрузить (CSV)</Button>}
      </Group>
      {query.data && (
        <Text size="xs" c="dimmed">
          Суммы без НДС, нарастающим итогом. Готовность и КС-2 — по срезу дашборда на {date(query.data.asOf)}. План — на выполненный объём (стоимость и лимиты × готовность). Показаны центры затрат с фактом ПЭО.
          Отклонение: плюс — лучше плана (больше выручки и прибыли, меньше расходов), минус — хуже.
        </Text>
      )}
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {!query.data ? <Skeleton height={420} /> : (
        <Paper withBorder radius="md">
          <Table.ScrollContainer minWidth={260 + units.length * 390}>
            <Table verticalSpacing={5} fz="sm" className="econ-nowrap econ-pnl" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th rowSpan={2} miw={240}>Статьи доходов и расходов</Table.Th>
                  {units.map((u) => (
                    <Table.Th key={u.key} colSpan={3} ta="center" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
                      {'dirId' in u && u.dirId ? (
                        <UnstyledButton onClick={() => update({ dir: u.dirId as number })}><Text size="sm" fw={600} td="underline" style={{ textDecorationStyle: 'dotted' }}>{u.title}</Text></UnstyledButton>
                      ) : <Text size="sm" fw={700}>{u.title}</Text>}
                    </Table.Th>
                  ))}
                </Table.Tr>
                <Table.Tr>
                  {units.map((u) => (
                    <Fragment key={u.key}>
                      <Table.Th ta="right" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>План</Table.Th>
                      <Table.Th ta="right">Факт</Table.Th>
                      <Table.Th ta="right">Отклонение</Table.Th>
                    </Fragment>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((l) => (
                  <Table.Tr key={l.key} bg={l.bold ? 'var(--mantine-color-default-hover)' : undefined}>
                    <Table.Td pl={l.level ? 28 : undefined}>
                      <Tooltip label={l.hint} disabled={!l.hint} multiline w={320}>
                        <Text size="sm" fw={l.bold ? 650 : undefined} c={l.level ? 'dimmed' : undefined} span style={l.hint ? { borderBottom: '1px dotted var(--mantine-color-dimmed)' } : undefined}>{l.label}</Text>
                      </Tooltip>
                    </Table.Td>
                    {units.map((u) => {
                      const v = l.get(u.p);
                      return (
                        <Fragment key={u.key}>
                          <Table.Td ta="right" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }} fw={l.bold ? 600 : undefined}>{fmt(v.plan, l.kind)}</Table.Td>
                          <Table.Td ta="right" fw={l.bold ? 650 : undefined}>{fmt(v.fact, l.kind)}</Table.Td>
                          <Table.Td ta="right"><Dev line={l} plan={v.plan} fact={v.fact} /></Table.Td>
                        </Fragment>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      {skipped.length > 0 && <Text size="xs" c="dimmed">Не вошли — нет готовности работ в дашборде на конец месяца: {skipped.map((b) => `${data.directions.find((d) => d.id === b.directionId)?.shortName} · ${b.title}`).join(', ')}.</Text>}
      {!search.dir && units.length > 1 && <Text size="xs" c="dimmed">Нажмите на название направления — откроются его центры затрат.</Text>}
    </Stack>
  );
}
