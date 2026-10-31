import { useMemo, useState } from 'react';
import { Alert, Box, Group, Paper, Select, SimpleGrid, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconAlertOctagon, IconAlertTriangle, IconCircleCheck, IconMinus } from '@tabler/icons-react';
import { ECON_STATUS_LABELS, econDefaultMonth, econIsCompanyKind, econMonthLabel, econStatus, type EconOverview, type EconSetup, type EconStatus } from '@mvs/shared';
import { economicsOverviewQuery } from '../../api';
import { EChart, baseOption } from '../../ui/EChart';
import { money, pct } from '../../ui/format';
import { analyse, total, type BudgetAnalysis, type Measure } from './analysis';
import { articleShort } from './EconLimits';
import { BudgetEditor } from './EconBudgetEditor';
import { STATUS_VAR, articleColor, qty, rub, signedPct } from './format';
import type { EconomicsSearch } from './search';

const ICON = { good: IconCircleCheck, warning: IconAlertTriangle, critical: IconAlertOctagon, none: IconMinus };
export function StatusMark({ status, label, size = 'sm' }: { status: EconStatus; label?: string; size?: 'xs' | 'sm' }) {
  const I = ICON[status];
  return (
    <Group gap={4} wrap="nowrap" c={STATUS_VAR[status]}>
      <I size={size === 'xs' ? 14 : 16} aria-hidden />
      <Text size={size} c={STATUS_VAR[status]} fw={500}>{label ?? ECON_STATUS_LABELS[status]}</Text>
    </Group>
  );
}

function Tile({ label, value, hint, status, tooltip }: { label: string; value: string; hint?: React.ReactNode; status?: EconStatus; tooltip: string }) {
  return (
    <Tooltip label={tooltip} multiline w={320}>
      <Paper withBorder p="md" radius="md" style={status && status !== 'none' ? { borderLeft: `4px solid ${STATUS_VAR[status]}` } : undefined}>
        <Text size="sm" c="dimmed" fw={500}>{label}</Text>
        <Text fz={24} fw={650} lh={1.3} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Text>
        {hint && <Box mt={2}>{typeof hint === 'string' ? <Text size="xs" c="dimmed">{hint}</Text> : hint}</Box>}
      </Paper>
    </Tooltip>
  );
}

/** Полоса освоения лимита: заливка — израсходовано, черта — сколько должно быть израсходовано по готовности работ. */
function BurnBar({ spent, progress, status }: { spent: number | null; progress: number | null; status: EconStatus }) {
  return (
    <Box pos="relative" h={14} style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 4 }}>
      <Box h="100%" w={`${Math.min(100, (spent ?? 0) * 100)}%`} style={{ background: STATUS_VAR[status], borderRadius: 4 }} />
      {progress != null && <Box pos="absolute" top={-4} bottom={-4} left={`calc(${Math.min(100, progress * 100)}% - 1px)`} w={3} style={{ background: 'var(--plan-mark)', borderRadius: 1 }} />}
    </Box>
  );
}

function Cell({ m, hours }: { m: Measure | undefined; hours?: boolean }) {
  if (!m || (m.fact == null && m.plan == null)) return <Table.Td ta="center"><Text span c="dimmed">—</Text></Table.Td>;
  if (m.fact == null || m.plan == null)
    return <Table.Td ta="center"><Text size="xs" c="dimmed">{m.fact == null ? 'нет факта' : 'нет готовности'}</Text></Table.Td>;
  const tip = hours
    ? `Норма × готовность: ${qty(m.plan)} · факт: ${qty(m.fact)}`
    : `Лимит ${rub(m.limit)} × готовность = план ${rub(m.plan)} · факт ${rub(m.fact)} · ${m.dev != null && m.dev < 0 ? 'перерасход' : 'экономия'} ${rub(m.dev == null ? null : Math.abs(m.dev))}`;
  const I = ICON[m.status];
  return (
    <Table.Td ta="center" p={3}>
      <Tooltip label={tip} multiline w={300}>
        <Group gap={4} justify="center" wrap="nowrap" py={6} px={6} style={{ borderRadius: 6, background: `color-mix(in srgb, ${STATUS_VAR[m.status]} 16%, transparent)` }}>
          <I size={14} color={STATUS_VAR[m.status]} aria-label={ECON_STATUS_LABELS[m.status]} />
          <Text size="sm" fw={500} style={{ fontVariantNumeric: 'tabular-nums' }}>{signedPct(m.devPct)}</Text>
        </Group>
      </Tooltip>
    </Table.Td>
  );
}

export function EconOverview({ data, search, update }: { data: EconSetup; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }) {
  const withRows = data.months.filter((m) => m.rows > 0).map((m) => m.month);
  const month = search.month ?? withRows[0] ?? econDefaultMonth();
  const query = useQuery(economicsOverviewQuery(month, search.dir));
  const [openId, setOpenId] = useState<number | null>(null);
  const direct = data.articles.filter((a) => !econIsCompanyKind(a.kind) && !a.isArchived);
  const budgets = data.budgets.filter((b) => !b.isArchived && (!search.dir || b.directionId === search.dir));
  const list = useMemo(() => budgets.map((b) => analyse(b, data.articles, query.data)), [budgets, data.articles, query.data]);
  const sorted = [...list].sort((a, b) => (a.direct.devPct ?? 1) - (b.direct.devPct ?? 1));
  const t = total(list);
  const dirName = (id: number) => data.directions.find((d) => d.id === id)?.shortName ?? '';
  const open = data.budgets.find((b) => b.id === openId);
  const choices = [...new Set([...withRows, month])].sort().reverse();

  if (!data.budgets.length)
    return <Alert color="gray">Центров затрат пока нет. Задайте лимиты на вкладке «Лимиты»{data.permissions.canAdmin ? ' или загрузите демо-данные в меню раздела (…)' : ''}.</Alert>;

  return (
    <Stack gap="lg">
      <Group gap="sm" align="flex-end">
        <Select label="Направление" w={220} data={[{ value: '', label: 'Все направления' }, ...data.directions.map((d) => ({ value: String(d.id), label: d.shortName }))]} value={search.dir ? String(search.dir) : ''} onChange={(v) => update({ dir: v ? Number(v) : undefined })} allowDeselect={false} />
        <Select label="Факт нарастающим итогом по" w={220} data={choices.map((m) => ({ value: m, label: econMonthLabel(m) }))} value={month} onChange={(v) => v && update({ month: v })} allowDeselect={false} />
      </Group>
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {!query.data ? <Skeleton height={420} /> : (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 5 }} spacing="sm">
            <Tile label="Лимит прямых расходов" value={money(t.limit)} hint={t.cost ? `${pct(t.limit != null ? t.limit / t.cost : null, 0)} стоимости без НДС` : undefined} tooltip="Сумма лимитов по прямым статьям (ФОТ, материалы, техника, субподряд, мусор) по центрам затрат без НДС." />
            <Tile label="План на выполненный объём" value={money(t.plan)} hint={`готовность работ ${pct(t.progress, 0)}`} tooltip="Сколько можно было потратить за уже сделанный объём: лимит × готовность работ из дашборда." />
            <Tile label="Факт расходов" value={money(t.fact)} hint={`освоено лимита ${pct(t.spentPct, 0)}${t.compared < t.withLimits ? ` · по ${t.compared} из ${t.withLimits} центров затрат` : ''}`} tooltip={`Факт ПЭО по прямым статьям нарастающим итогом по ${econMonthLabel(month).toLowerCase()} включительно.`} />
            <Tile
              label={t.dev != null && t.dev < 0 ? 'Перерасход' : 'Экономия'}
              value={money(t.dev == null ? null : Math.abs(t.dev))}
              status={t.status}
              hint={<StatusMark status={t.status} size="xs" label={`${signedPct(t.devPct)} к плану · ${ECON_STATUS_LABELS[t.status].toLowerCase()}`} />}
              tooltip="План на выполненный объём минус факт. Плюс — экономия, минус — перерасход (убыток)."
            />
            <Tile
              label="Прогноз на завершение"
              value={t.forecast == null ? '—' : `${t.forecast < 0 ? '−' : '+'}${money(Math.abs(t.forecast))}`}
              status={t.forecast == null ? undefined : econStatus(t.forecast / (t.limit || 1))}
              hint={t.forecast == null ? 'мало данных' : t.forecast < 0 ? 'ожидаемый перерасход' : 'ожидаемая экономия'}
              tooltip="Если эффективность сохранится: лимит − факт ÷ готовность. Считается по центрам затрат с готовностью от 5%."
            />
          </SimpleGrid>

          <Paper withBorder p="md" radius="md">
            <Group justify="space-between" align="flex-start" mb="sm" gap="xs">
              <div>
                <Text fw={600}>Освоение лимита и готовность работ</Text>
                <Text size="xs" c="dimmed">Полоса — израсходовано от лимита прямых расходов, черта — готовность работ (столько должно быть израсходовано). Полоса правее черты — расходы опережают работы.</Text>
              </div>
            </Group>
            <Stack gap={10}>
              {sorted.map((x) => (
                <UnstyledButton key={x.b.id} onClick={() => setOpenId(x.b.id)} aria-label={`Открыть лимиты: ${x.b.title}`}>
                  <Box className="econ-burn-row">
                    <div>
                      <Text size="sm" fw={500} lineClamp={1}>{x.b.title}</Text>
                      <Text size="xs" c="dimmed">{dirName(x.b.directionId)} · лимит {money(x.direct.limit)}</Text>
                    </div>
                    <Stack gap={2} justify="center">
                      <BurnBar spent={x.spentPct} progress={x.b.progress} status={x.direct.status} />
                      <Text size="xs" c="dimmed">израсходовано {pct(x.spentPct, 0)} · готовность {pct(x.b.progress, 0)}</Text>
                    </Stack>
                    <Stack gap={0} justify="center" align="flex-end">
                      <StatusMark status={x.direct.status} size="xs" label={x.direct.fact == null ? 'Нет факта' : `${signedPct(x.direct.devPct)} · ${money(x.direct.dev == null ? null : Math.abs(x.direct.dev))}`} />
                      {x.forecast?.result != null && <Text size="xs" c="dimmed">прогноз: {x.forecast.result < 0 ? 'перерасход' : 'экономия'} {money(Math.abs(x.forecast.result))}</Text>}
                    </Stack>
                  </Box>
                </UnstyledButton>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Text fw={600}>Отклонения по статьям</Text>
            <Text size="xs" c="dimmed" mb="sm">Факт против плана на выполненный объём (лимит статьи × готовность). Плюс — экономия, минус — перерасход. Наведите на ячейку — суммы.</Text>
            <Table.ScrollContainer minWidth={260 + direct.length * 110 + 220}>
              <Table verticalSpacing={2} fz="sm" className="econ-nowrap">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Центр затрат</Table.Th>
                    {direct.map((a) => <Table.Th key={a.id} ta="center"><Tooltip label={a.name}><span>{articleShort(a)}</span></Tooltip></Table.Th>)}
                    <Table.Th ta="center">Трудочасы</Table.Th>
                    <Table.Th ta="center">Маш.-часы</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sorted.map((x) => (
                    <Table.Tr key={x.b.id}>
                      <Table.Td><Text size="sm" lineClamp={1}>{x.b.title}</Text><Text size="xs" c="dimmed">{dirName(x.b.directionId)}</Text></Table.Td>
                      {direct.map((a) => <Cell key={a.id} m={x.byArticle.get(a.id)} />)}
                      <Cell m={x.labor} hours />
                      <Cell m={x.machine} hours />
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group gap="md" mt="xs">
              {(['good', 'warning', 'critical'] as const).map((s) => <StatusMark key={s} status={s} size="xs" />)}
            </Group>
          </Paper>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Paper withBorder p="md" radius="md">
              <Text fw={600}>Расходы по месяцам</Text>
              <Text size="xs" c="dimmed">Факт ПЭО за 12 месяцев: {search.dir ? 'прямые статьи по центрам затрат направления' : 'прямые статьи по центрам затрат и общие расходы компании'}, млн ₽ без НДС.</Text>
              <MonthlyChart data={data} overview={query.data} />
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text fw={600}>Структура стоимости по лимитам</Text>
              <Text size="xs" c="dimmed" mb="sm">Лимиты статей в стоимости без НДС; остаток — плановая маржа до прибыли.</Text>
              <Structure data={data} list={list} />
            </Paper>
          </SimpleGrid>
          <Text size="xs" c="dimmed">Общепроизводственные и административные расходы сравниваются с лимитами после разнесения по выручке объектов — на следующем этапе.</Text>
        </>
      )}
      {open && <BudgetEditor budget={open} data={data} onClose={() => setOpenId(null)} />}
    </Stack>
  );
}

function MonthlyChart({ data, overview }: { data: EconSetup; overview: EconOverview }) {
  const shown = data.articles.filter((a) => overview.monthly.some((m) => m.byArticle[a.id]));
  const labels = overview.monthly.map((m) => econMonthLabel(m.month).replace(/^(\S{3})\S*/, '$1').toLowerCase());
  return (
    <EChart
      height={300}
      ariaLabel="Расходы по месяцам по статьям, млн рублей"
      option={(c) => ({
        ...baseOption(c),
        legend: { ...baseOption(c).legend, type: 'scroll' },
        grid: { left: 8, right: 12, top: 48, bottom: 8, containLabel: true },
        tooltip: {
          ...baseOption(c).tooltip,
          valueFormatter: (v) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(v))} млн ₽`,
        },
        xAxis: { type: 'category', data: labels, axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.grid } } },
        yAxis: { type: 'value', axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.grid } } },
        series: shown.map((a) => ({
          type: 'bar',
          stack: 'all',
          name: a.name,
          barMaxWidth: 28,
          itemStyle: { color: c.cat[Math.max(0, data.articles.findIndex((x) => x.id === a.id)) % 10], borderColor: c.surface, borderWidth: 1 },
          data: overview.monthly.map((m) => (m.byArticle[a.id] ? Math.round(m.byArticle[a.id] / 1e5) / 10 : null)),
        })),
      })}
    />
  );
}

function Structure({ data, list: all }: { data: EconSetup; list: BudgetAnalysis[] }) {
  // только центры затрат с лимитами: иначе их стоимость целиком попала бы в «маржу»
  const list = all.filter((x) => x.b.limitTotal);
  const cost = list.reduce((s, x) => s + (x.b.costBase ?? 0), 0);
  const rows = data.articles
    .map((a) => ({ a, v: list.reduce((s, x) => s + (x.b.limits.find((l) => l.articleId === a.id)?.value ?? 0), 0) }))
    .filter((r) => r.v > 0);
  const limits = rows.reduce((s, r) => s + r.v, 0);
  const margin = cost - limits;
  if (!cost) return <Text size="sm" c="dimmed">Нет стоимости без НДС.</Text>;
  return (
    <Stack gap="sm">
      <Group gap={2} wrap="nowrap" h={22} style={{ borderRadius: 4, overflow: 'hidden' }} aria-hidden>
        {rows.map((r) => <Box key={r.a.id} h="100%" style={{ flex: `${r.v} 0 0`, background: articleColor(data.articles, r.a.id) }} />)}
        {margin > 0 && <Box h="100%" style={{ flex: `${margin} 0 0`, background: 'var(--mantine-color-default-hover)' }} />}
      </Group>
      <Table verticalSpacing={3} fz="sm" className="econ-nowrap">
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.a.id}>
              <Table.Td><Group gap={8} wrap="nowrap"><Box w={10} h={10} style={{ borderRadius: 2, background: articleColor(data.articles, r.a.id), flexShrink: 0 }} /><Text size="sm" lineClamp={1}>{r.a.name}</Text></Group></Table.Td>
              <Table.Td ta="right">{money(r.v)}</Table.Td>
              <Table.Td ta="right" w={70}>{pct(r.v / cost)}</Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr>
            <Table.Td><Group gap={8} wrap="nowrap"><Box w={10} h={10} style={{ borderRadius: 2, background: 'var(--mantine-color-default-hover)', border: '1px solid var(--mantine-color-default-border)' }} /><Text size="sm" fw={600}>Плановая маржа</Text></Group></Table.Td>
            <Table.Td ta="right" fw={600} c={margin < 0 ? 'var(--status-critical)' : undefined}>{money(margin)}</Table.Td>
            <Table.Td ta="right" fw={600}>{pct(margin / cost)}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      {margin < 0 && <StatusMark status="critical" size="xs" label="Лимиты больше стоимости — заложен убыток" />}
    </Stack>
  );
}
