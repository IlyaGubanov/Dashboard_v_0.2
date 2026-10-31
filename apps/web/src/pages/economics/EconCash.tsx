import { Fragment, useMemo } from 'react';
import { Alert, Button, Group, Paper, SegmentedControl, Select, SimpleGrid, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconDownload } from '@tabler/icons-react';
import { ECON_CASH_COMPANY, econCashBalance, econMonthLabel, econStatus, econYearMonths, type EconCashMonth, type EconCashView, type EconSetup, type EconStatus } from '@mvs/shared';
import { economicsCashQuery } from '../../api';
import { EChart, baseOption } from '../../ui/EChart';
import { money } from '../../ui/format';
import { StatusMark } from './EconOverview';
import { EconCashEntry } from './EconCashEntry';
import { STATUS_VAR, downloadCsv, rub } from './format';
import type { EconomicsSearch } from './search';

const ALL = 'all';
const shortMonth = (m: string) => econMonthLabel(m).slice(0, 3).toLowerCase();

/** Сумма плана и факта по выбранным таблицам ДДС: статья → месяц → значение. */
function aggregate(view: EconCashView, scopes: string[]) {
  const kind = new Map(view.articles.map((a) => [a.id, a.kind]));
  const months = econYearMonths(view.year);
  const byMonth: EconCashMonth[] = months.map((month) => ({ month, inPlan: 0, outPlan: 0, inFact: 0, outFact: 0 }));
  const byArticle = new Map<number, { plan: Record<string, number>; fact: Record<string, number> }>();
  let hasFact = '';
  for (const s of view.sheets.filter((x) => scopes.includes(x.scope)))
    for (const e of s.entries) {
      const m = byMonth[months.indexOf(e.month)];
      if (!m) continue;
      const k = kind.get(e.articleId) === 'IN' ? 'in' : 'out';
      m[`${k}Plan`] += e.plan ?? 0;
      m[`${k}Fact`] += e.fact ?? 0;
      if (e.fact != null && e.month > hasFact) hasFact = e.month;
      const a = byArticle.get(e.articleId) ?? { plan: {}, fact: {} };
      if (e.plan != null) a.plan[e.month] = (a.plan[e.month] ?? 0) + e.plan;
      if (e.fact != null) a.fact[e.month] = (a.fact[e.month] ?? 0) + e.fact;
      byArticle.set(e.articleId, a);
    }
  return { byMonth, byArticle, lastFact: hasFact || null };
}

const sumUpTo = (rec: Record<string, number> | undefined, until: string) => (rec ? Object.entries(rec).filter(([m]) => m <= until).reduce((a, [, v]) => a + v, 0) : 0);

function Tile({ label, value, hint, status }: { label: string; value: string; hint?: React.ReactNode; status?: EconStatus }) {
  return (
    <Paper withBorder p="md" radius="md" style={status && status !== 'none' ? { borderLeft: `4px solid ${STATUS_VAR[status]}` } : undefined}>
      <Text size="sm" c="dimmed" fw={500}>{label}</Text>
      <Text fz={22} fw={650} lh={1.3} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Text>
      {hint && <div>{typeof hint === 'string' ? <Text size="xs" c="dimmed">{hint}</Text> : hint}</div>}
    </Paper>
  );
}

export function EconCash({ data, search, update }: { data: EconSetup; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }) {
  const year = search.year ?? new Date().getFullYear();
  const query = useQuery(economicsCashQuery(year));
  const mode = search.cash ?? 'analysis';
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" gap="sm">
        <SegmentedControl value={mode} onChange={(v) => update({ cash: v === 'entry' ? 'entry' : undefined })} data={[{ value: 'analysis', label: 'Анализ' }, { value: 'entry', label: 'План и факт' }]} />
        <Select label="Год" w={110} data={years} value={String(year)} onChange={(v) => v && update({ year: Number(v) })} allowDeselect={false} />
      </Group>
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {!query.data ? <Skeleton height={420} /> : mode === 'entry' ? <EconCashEntry data={data} view={query.data} search={search} update={update} /> : <Analysis view={query.data} search={search} update={update} canExport={data.canExport} />}
    </Stack>
  );
}

function Analysis({ view, search, update, canExport }: { view: EconCashView; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void; canExport: boolean }) {
  const scope = search.scope ?? ALL;
  const scopes = scope === ALL ? view.scopes.map((s) => s.scope) : [scope];
  const whole = scope === ALL && view.scopes.some((s) => s.scope === ECON_CASH_COMPANY);
  const agg = useMemo(() => aggregate(view, scopes), [view, scopes.join(',')]);
  const months = econYearMonths(view.year);
  const until = search.month && months.includes(search.month) ? search.month : (agg.lastFact ?? months[11]);
  const opening = whole ? (view.sheets.find((s) => s.scope === ECON_CASH_COMPANY)?.opening ?? null) : null;
  const bal = econCashBalance(opening, agg.byMonth, agg.lastFact);
  const period = agg.byMonth.filter((m) => m.month <= until);
  const tot = (f: (m: EconCashMonth) => number) => period.reduce((a, m) => a + f(m), 0);
  const inF = tot((m) => m.inFact), inP = tot((m) => m.inPlan), outF = tot((m) => m.outFact), outP = tot((m) => m.outPlan);
  const receivable = view.scopes.filter((s) => scopes.includes(s.scope)).map((s) => view.hints[s.scope]?.receivable).filter((x): x is number => x != null);
  const status = (fact: number, plan: number, good: 1 | -1) => (plan ? econStatus((good * (fact - plan)) / plan) : undefined);
  const endBalance = bal.series.find((x) => x.month === until)?.balance ?? null;
  const ins = view.articles.filter((a) => a.kind === 'IN');
  const outs = view.articles.filter((a) => a.kind === 'OUT');
  const cols = scope === ALL ? [{ scope: ALL, title: 'Вся компания' }, ...view.scopes] : view.scopes.filter((s) => s.scope === scope);
  const colAgg = useMemo(() => new Map(cols.map((c) => [c.scope, c.scope === ALL ? agg : aggregate(view, [c.scope])])), [view, agg, cols.map((c) => c.scope).join(',')]);

  const cell = (a: { plan: Record<string, number>; fact: Record<string, number> } | undefined) => ({ plan: sumUpTo(a?.plan, until), fact: sumUpTo(a?.fact, until) });
  const group = (c: string, list: typeof ins) => list.reduce((acc, a) => { const v = cell(colAgg.get(c)?.byArticle.get(a.id)); return { plan: acc.plan + v.plan, fact: acc.fact + v.fact }; }, { plan: 0, fact: 0 });

  function exportCsv() {
    const row = (label: string, get: (c: string) => { plan: number; fact: number }) => [label, ...cols.flatMap((c) => { const v = get(c.scope); return [v.plan || null, v.fact || null]; })];
    downloadCsv(`ДДС ${view.year} по ${econMonthLabel(until)}.csv`, [
      ['Статья', ...cols.flatMap((c) => [`${c.title}: план`, `${c.title}: факт`])],
      row('Поступления', (c) => group(c, ins)),
      ...ins.map((a) => row(a.name, (c) => cell(colAgg.get(c)?.byArticle.get(a.id)))),
      row('Выплаты', (c) => group(c, outs)),
      ...outs.map((a) => row(a.name, (c) => cell(colAgg.get(c)?.byArticle.get(a.id)))),
    ]);
  }

  if (!view.sheets.some((s) => s.version)) return <Alert color="gray">ДДС за {view.year} год ещё не внесён. Перейдите в «План и факт».</Alert>;

  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end" justify="space-between">
        <Group gap="sm" align="flex-end">
          <Select label="Таблица" w={240} data={[{ value: ALL, label: 'Вся компания' }, ...view.scopes.map((s) => ({ value: s.scope, label: s.title }))]} value={scope} onChange={(v) => update({ scope: !v || v === ALL ? undefined : v })} allowDeselect={false} />
          <Select label="С начала года по" w={200} data={months.map((m) => ({ value: m, label: econMonthLabel(m) }))} value={until} onChange={(v) => v && update({ month: v })} allowDeselect={false} />
        </Group>
        {canExport && <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv}>Выгрузить (CSV)</Button>}
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 5 }} spacing="sm">
        <Tile label="Поступления" value={money(inF)} status={status(inF, inP, 1)} hint={<StatusMark status={status(inF, inP, 1) ?? 'none'} size="xs" label={`план ${money(inP)}`} />} />
        <Tile label="Выплаты" value={money(outF)} status={status(outF, outP, -1)} hint={<StatusMark status={status(outF, outP, -1) ?? 'none'} size="xs" label={`план ${money(outP)}`} />} />
        <Tile label="Чистый денежный поток" value={money(inF - outF)} hint={`план ${money(inP - outP)}`} status={inF - outF < 0 ? 'warning' : undefined} />
        {whole ? (
          <Tile label={`Остаток на конец: ${econMonthLabel(until).toLowerCase()}`} value={money(endBalance)} hint={opening == null ? 'не задан остаток на начало года' : `на 1 января ${money(opening)}`} status={endBalance != null && endBalance < 0 ? 'critical' : undefined} />
        ) : (
          <Tile label="Дебиторская задолженность" value={receivable.length ? money(receivable.reduce((a, x) => a + x, 0)) : '—'} hint="КС-2 − оплачено заказчиком, по дашборду" />
        )}
        <Tile
          label="Кассовый разрыв"
          value={bal.gap ? money(bal.gap.value) : 'не ожидается'}
          status={bal.gap ? 'critical' : 'good'}
          hint={bal.gap ? <StatusMark status="critical" size="xs" label={`${econMonthLabel(bal.gap.month)}${agg.lastFact && bal.gap.month > agg.lastFact ? ' · по плану' : ''}`} /> : <StatusMark status="good" size="xs" label={whole ? `минимум ${money(bal.min?.balance ?? null)}` : 'накопленный поток не уходит в минус'} />}
        />
      </SimpleGrid>
      {!whole && <Text size="xs" c="dimmed">Для отдельной таблицы остаток не считается — показан накопленный денежный поток с начала года. Остаток денег и кассовый разрыв — для всей компании (нужен остаток на начало года в «Общих по компании»).</Text>}

      <Paper withBorder p="md" radius="md">
        <Text fw={600}>Поступления, выплаты и {whole ? 'остаток денег' : 'накопленный поток'}</Text>
        <Text size="xs" c="dimmed">Млн ₽ с НДС. До {agg.lastFact ? econMonthLabel(agg.lastFact).toLowerCase() : '—'} — факт, дальше — план (бледнее). Линия ниже нуля — кассовый разрыв.</Text>
        <EChart
          height={320}
          ariaLabel="Поступления, выплаты и остаток денег по месяцам"
          option={(c) => {
            const mln = (v: number) => Math.round(v / 1e5) / 10;
            const actual = (m: string) => !!agg.lastFact && m <= agg.lastFact;
            return {
              ...baseOption(c),
              grid: { left: 8, right: 12, top: 48, bottom: 8, containLabel: true },
              tooltip: { ...baseOption(c).tooltip, valueFormatter: (v) => `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽` },
              xAxis: { type: 'category', data: months.map(shortMonth), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.grid } } },
              yAxis: { type: 'value', axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.grid } } },
              series: [
                { type: 'bar', name: 'Поступления', stack: 'flow', barMaxWidth: 26, itemStyle: { color: c.series[0] }, data: agg.byMonth.map((m) => ({ value: mln(actual(m.month) ? m.inFact : m.inPlan), itemStyle: { opacity: actual(m.month) ? 1 : 0.4 } })) },
                { type: 'bar', name: 'Выплаты', stack: 'flow', barMaxWidth: 26, itemStyle: { color: c.series[1] }, data: agg.byMonth.map((m) => ({ value: -mln(actual(m.month) ? m.outFact : m.outPlan), itemStyle: { opacity: actual(m.month) ? 1 : 0.4 } })) },
                {
                  type: 'line',
                  name: whole ? 'Остаток' : 'Накопленный поток',
                  symbolSize: 8,
                  itemStyle: { color: c.text },
                  lineStyle: { width: 2, color: c.text },
                  // точки ниже нуля — кассовый разрыв, крупнее и красным
                  data: bal.series.map((x) => ({ value: mln(x.balance), symbolSize: x.balance < 0 ? 12 : 8, itemStyle: { color: x.balance < 0 ? c.critical : c.text, borderColor: c.surface, borderWidth: 2 } })),
                  markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: c.muted, type: 'dashed' }, data: [{ yAxis: 0 }] },
                },
              ],
            };
          }}
        />
      </Paper>

      <Paper withBorder radius="md">
        <Table.ScrollContainer minWidth={260 + cols.length * 380}>
          <Table verticalSpacing={5} fz="sm" className="econ-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th rowSpan={2} miw={240}>Статьи поступлений и выплат, с НДС</Table.Th>
                {cols.map((c) => (
                  <Table.Th key={c.scope} colSpan={3} ta="center" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
                    {c.scope !== ALL && scope === ALL ? (
                      <UnstyledButton onClick={() => update({ scope: c.scope })}><Text size="sm" fw={600} td="underline" style={{ textDecorationStyle: 'dotted' }}>{c.title}</Text></UnstyledButton>
                    ) : <Text size="sm" fw={700}>{c.title}</Text>}
                  </Table.Th>
                ))}
              </Table.Tr>
              <Table.Tr>
                {cols.map((c) => (
                  <Fragment key={c.scope}>
                    <Table.Th ta="right" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>План</Table.Th>
                    <Table.Th ta="right">Факт</Table.Th>
                    <Table.Th ta="right">Отклонение</Table.Th>
                  </Fragment>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(
                [
                  { key: 'in', label: 'Поступления', bold: true, good: 1 as const, get: (c: string) => group(c, ins) },
                  ...ins.map((a) => ({ key: `a${a.id}`, label: a.name, bold: false, good: 1 as const, get: (c: string) => cell(colAgg.get(c)?.byArticle.get(a.id)) })),
                  { key: 'out', label: 'Выплаты', bold: true, good: -1 as const, get: (c: string) => group(c, outs) },
                  ...outs.map((a) => ({ key: `a${a.id}`, label: a.name, bold: false, good: -1 as const, get: (c: string) => cell(colAgg.get(c)?.byArticle.get(a.id)) })),
                  { key: 'net', label: 'Чистый денежный поток', bold: true, good: 1 as const, get: (c: string) => { const i = group(c, ins), o = group(c, outs); return { plan: i.plan - o.plan, fact: i.fact - o.fact }; } },
                ]
              ).map((l) => (
                <Table.Tr key={l.key} bg={l.bold ? 'var(--mantine-color-default-hover)' : undefined}>
                  <Table.Td pl={l.bold ? undefined : 28}><Text size="sm" fw={l.bold ? 650 : undefined} c={l.bold ? undefined : 'dimmed'}>{l.label}</Text></Table.Td>
                  {cols.map((c) => {
                    const v = l.get(c.scope);
                    const d = l.good * (v.fact - v.plan);
                    const st = v.plan ? econStatus(d / Math.abs(v.plan)) : 'none';
                    return (
                      <Fragment key={c.scope}>
                        <Table.Td ta="right" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }} fw={l.bold ? 600 : undefined}>{v.plan ? rub(v.plan) : '—'}</Table.Td>
                        <Table.Td ta="right" fw={l.bold ? 650 : undefined}>{v.fact ? rub(v.fact) : '—'}</Table.Td>
                        <Table.Td ta="right">
                          {v.plan || v.fact ? (
                            <Tooltip label={v.plan ? `${d >= 0 ? 'Лучше' : 'Хуже'} плана на ${Math.abs((d / Math.abs(v.plan)) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %` : 'Плана нет'}>
                              <Text span c={STATUS_VAR[st]} fw={500}>{d > 0.5 ? '+' : d < -0.5 ? '−' : ''}{rub(Math.abs(d))}</Text>
                            </Tooltip>
                          ) : <Text span c="dimmed">—</Text>}
                        </Table.Td>
                      </Fragment>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Text size="xs" c="dimmed">С начала года по {econMonthLabel(until).toLowerCase()} включительно. Отклонение: плюс — лучше плана (больше поступлений, меньше выплат), минус — хуже.</Text>
    </Stack>
  );
}
