import { useMemo, useState } from 'react';
import { Alert, Box, Button, Card, Group, SegmentedControl, Select, Skeleton, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconChevronDown, IconChevronUp, IconDownload, IconSearch } from '@tabler/icons-react';
import type { SiteKpiRow } from '@mvs/shared';
import { directionQueries } from '../../api';
import { RiskBadge, riskColor } from '../../ui/RiskBadge';
import { ForecastLabel, forecastSort } from '../../ui/ForecastLabel';
import { int, money, pct } from '../../ui/format';
import { Lag } from '../../ui/Lag';
import { useFinanceHidden } from '../../ui/finance';
import { useAccess } from '../../ui/access';

type SortKey = 'num' | 'name' | 'contractor' | 'fact' | 'plan' | 'lag' | 'portfolio' | 'closed' | 'paid' | 'people' | 'remarks' | 'remarksOpen' | 'forecast';
type RiskFilter = 'all' | 'lag' | 'crit' | 'ok' | 'done';

const RISK_FILTERS: { value: RiskFilter; label: string; test: (r: SiteKpiRow) => boolean }[] = [
  { value: 'all', label: 'Все', test: () => true },
  { value: 'lag', label: 'Отстают', test: (r) => r.risk === 'warn' || r.risk === 'crit' },
  { value: 'crit', label: 'Критично', test: (r) => r.risk === 'crit' },
  { value: 'ok', label: 'В графике', test: (r) => r.risk === 'ok' || r.risk === 'wait' },
  { value: 'done', label: 'Выполнено', test: (r) => r.risk === 'done' },
];

const value = (r: SiteKpiRow, k: SortKey): number | string | null => {
  switch (k) {
    case 'num':
      return r.num;
    case 'name':
      return r.shortName;
    case 'contractor':
      return r.contractor?.name ?? null;
    case 'portfolio':
    case 'closed':
    case 'paid':
      return r.money[k];
    case 'forecast':
      return forecastSort(r.forecast);
    default:
      return r[k];
  }
};

/** Без подрядчика — отдельный пункт фильтра. */
const NO_CONTRACTOR = 'none';

/** Подрядчики объекта: подрядчик объекта и подрядчики отдельных позиций. */
const contractorsOf = (r: SiteKpiRow) => [...(r.contractor ? [r.contractor] : []), ...r.subcontractors];

/** Реестр объектов направления: поиск, фильтры, сортировка, выгрузка; щелчок — карточка объекта. */
export function SitesTab({
  code,
  date,
  contractor,
  onContractor,
  onOpenSite,
}: {
  code: string;
  date?: string;
  /** отбор по подрядчику (id организации или 'none') — в адресе страницы */
  contractor?: string;
  onContractor: (v: string | undefined) => void;
  onOpenSite: (id: number) => void;
}) {
  const { data, error } = useQuery(directionQueries.sites(code, date));
  const [q, setQ] = useState('');
  const [section, setSection] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lag', dir: 1 });
  const financeHidden = useFinanceHidden();
  const canExport = useAccess().has('export');

  const rows = useMemo(() => data ?? [], [data]);
  const has = useMemo(
    () => ({
      plan: rows.some((r) => r.plan != null),
      money: !financeHidden && rows.some((r) => r.money.portfolio != null),
      closed: !financeHidden && rows.some((r) => r.money.closed != null),
      paid: !financeHidden && rows.some((r) => r.money.paid != null),
      contractors: [...new Map(rows.flatMap(contractorsOf).map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      noContractor: rows.some((r) => !contractorsOf(r).length),
      people: rows.some((r) => r.people != null),
      remarks: rows.some((r) => r.remarks != null),
      remarksOpen: rows.some((r) => r.remarksOpen > 0),
      forecast: rows.some((r) => r.forecast && r.forecast.status !== 'nodata'),
      sections: [...new Set(rows.map((r) => r.section?.name).filter(Boolean))] as string[],
    }),
    [rows, financeHidden],
  );

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const test = RISK_FILTERS.find((f) => f.value === risk)!.test;
    return rows
      .filter(
        (r) =>
          (!ql || r.name.toLowerCase().includes(ql) || r.curators.some((c) => c.toLowerCase().includes(ql)) || contractorsOf(r).some((c) => c.name.toLowerCase().includes(ql))) &&
          test(r),
      )
      .filter((r) => !section || r.section?.name === section)
      .filter((r) => !contractor || (contractor === NO_CONTRACTOR ? !contractorsOf(r).length : contractorsOf(r).some((c) => String(c.id) === contractor)))
      .sort((a, b) => {
        const x = value(a, sort.key), y = value(b, sort.key);
        if (x == null && y == null) return 0;
        if (x == null) return 1; // пустые — всегда внизу
        if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(String(y), 'ru') : x - (y as number)) * sort.dir;
      });
  }, [rows, q, section, risk, sort, contractor]);

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;

  const th = (key: SortKey, label: string, right = true) => (
    <Table.Th ta={right ? 'right' : undefined}>
      <UnstyledButton
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'name' || key === 'num' || key === 'lag' ? 1 : -1 }))}
        aria-label={`Сортировать: ${label}`}
      >
        <Group gap={2} wrap="nowrap" justify={right ? 'flex-end' : undefined}>
          <Text size="sm" fw={600}>
            {label}
          </Text>
          {sort.key === key && (sort.dir === 1 ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );

  return (
    <Card withBorder padding={0}>
      <Group p="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Объект, куратор, подрядчик"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={260}
        />
        {has.sections.length > 1 && (
          <Select aria-label="Все разделы" placeholder="Все разделы" clearable data={has.sections} value={section} onChange={setSection} w={220} />
        )}
        {has.contractors.length > 0 && (
          <Select
            placeholder="Все подрядчики"
            clearable
            searchable
            data={[
              ...has.contractors.map((c) => ({ value: String(c.id), label: c.name })),
              ...(has.noContractor ? [{ value: NO_CONTRACTOR, label: 'Подрядчик не указан' }] : []),
            ]}
            value={contractor ?? null}
            onChange={(v) => onContractor(v ?? undefined)}
            w={240}
            aria-label="Подрядчик"
          />
        )}
        {has.plan && (
          <SegmentedControl size="sm" value={risk} onChange={(v) => setRisk(v as RiskFilter)} data={RISK_FILTERS.map(({ value, label }) => ({ value, label }))} />
        )}
        <Text size="sm" c="dimmed" ml="auto">
          {shown.length} из {rows.length}
        </Text>
        {canExport && (
          <Button variant="default" size="sm" leftSection={<IconDownload size={16} />} onClick={() => exportCsv(code, shown, has)}>
            В Excel
          </Button>
        )}
      </Group>
      <Table.ScrollContainer minWidth={900}>
        <Table striped highlightOnHover verticalSpacing="xs" styles={{ td: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              {th('num', '№')}
              {th('name', 'Объект', false)}
              <Table.Th>Состояние</Table.Th>
              {has.contractors.length > 0 && th('contractor', 'Подрядчик', false)}
              {th('fact', 'Факт')}
              {has.plan && th('plan', 'План')}
              {has.plan && th('lag', 'Откл.')}
              {has.forecast && th('forecast', 'Прогноз', false)}
              {has.money && th('portfolio', 'Стоимость')}
              {has.closed && th('closed', 'КС-2')}
              {has.paid && th('paid', 'Оплачено')}
              {has.people && th('people', 'Люди')}
              {has.remarks && th('remarks', 'Замеч.')}
              {has.remarksOpen && th('remarksOpen', 'Замечаний открыто')}
              <Table.Th>Куратор</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((r) => (
              <Table.Tr key={r.id} style={{ cursor: 'pointer' }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpenSite(r.id); }} onClick={() => onOpenSite(r.id)}>
                <Table.Td ta="right">{r.num ?? ''}</Table.Td>
                <Table.Td style={{ whiteSpace: 'normal', minWidth: 260 }}>
                  <Text size="sm" fw={500} lineClamp={2}>
                    {r.shortName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {[r.section?.name, r.status?.name ?? r.statusText].filter(Boolean).join(' · ')}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <RiskBadge risk={r.risk} size="xs" />
                </Table.Td>
                {has.contractors.length > 0 && (
                  <Table.Td style={{ whiteSpace: 'normal', minWidth: 160 }}>
                    <Text size="sm" lineClamp={2}>
                      {r.contractor?.name ?? '—'}
                    </Text>
                    {r.subcontractors.length > 0 && (
                      <Tooltip label={r.subcontractors.map((c) => c.name).join(', ')} multiline w={260}>
                        <Text size="xs" c="dimmed" style={{ cursor: 'help' }}>
                          + по позициям: {r.subcontractors.length}
                        </Text>
                      </Tooltip>
                    )}
                  </Table.Td>
                )}
                <Table.Td ta="right">
                  <Group gap={8} justify="flex-end" wrap="nowrap">
                    <Box w={60} h={6} style={{ background: 'var(--track)', borderRadius: 3 }}>
                      <Box h={6} style={{ width: `${(r.fact ?? 0) * 100}%`, background: r.plan == null ? 'var(--series-1)' : riskColor(r.risk), borderRadius: 3 }} />
                    </Box>
                    <Text size="sm" w={48}>
                      {pct(r.fact, 0)}
                    </Text>
                  </Group>
                </Table.Td>
                {has.plan && <Table.Td ta="right">{pct(r.plan, 0)}</Table.Td>}
                {has.plan && (
                  <Table.Td ta="right">
                    <Lag v={r.lag} crit={r.risk === 'crit'} fw={r.risk === 'crit' ? 700 : undefined} />
                  </Table.Td>
                )}
                {has.forecast && (
                  <Table.Td>
                    <ForecastLabel f={r.forecast} />
                  </Table.Td>
                )}
                {has.money && <Table.Td ta="right">{money(r.money.portfolio)}</Table.Td>}
                {has.closed && <Table.Td ta="right">{money(r.money.closed)}</Table.Td>}
                {has.paid && <Table.Td ta="right">{money(r.money.paid)}</Table.Td>}
                {has.people && <Table.Td ta="right">{int(r.people)}</Table.Td>}
                {has.remarks && <Table.Td ta="right">{int(r.remarks)}</Table.Td>}
                {has.remarksOpen && (
                  <Table.Td ta="right">
                    {r.remarksOpen ? int(r.remarksOpen) : ''}
                    {r.remarksOverdue > 0 && (
                      <Text span size="xs" fw={700} c="var(--status-critical)">
                        {` · просроч. ${r.remarksOverdue}`}
                      </Text>
                    )}
                  </Table.Td>
                )}
                <Table.Td>
                  <Text size="sm" truncate maw={200}>
                    {r.curators.join(', ') || '—'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!shown.length && (
        <Text c="dimmed" ta="center" p="lg">
          Ничего не найдено
        </Text>
      )}
    </Card>
  );
}

/** Выгрузка отфильтрованного реестра в CSV (открывается в Excel: разделитель «;», UTF-8 с BOM). */
function exportCsv(code: string, rows: SiteKpiRow[], has: { plan: boolean; money: boolean; closed: boolean; paid: boolean; people: boolean; remarksOpen: boolean; forecast: boolean; contractors: unknown[] }) {
  const n = (v: number | null, k = 1) => (v == null ? '' : String(Math.round(v * k * 100) / 100).replace('.', ','));
  const head = ['№', 'Объект', 'Раздел', 'Состояние'];
  if (has.contractors.length) head.push('Подрядчик', 'Подрядчики позиций');
  head.push('Факт, %');
  if (has.plan) head.push('План, %', 'Отклонение, п.п.');
  if (has.money) head.push('Стоимость, ₽');
  if (has.closed) head.push('КС-2, ₽');
  if (has.paid) head.push('Оплачено, ₽');
  if (has.people) head.push('Людей', 'Техники');
  if (has.remarksOpen) head.push('Замечаний открыто', 'Из них просрочено');
  if (has.forecast) head.push('Прогноз завершения', 'Опережение (+) / отставание (−) прогноза, дн.');
  head.push('Куратор');
  const lines = rows.map((r) => {
    const c = [String(r.num ?? ''), r.name, r.section?.name ?? '', r.risk];
    if (has.contractors.length) c.push(r.contractor?.name ?? '', r.subcontractors.map((x) => x.name).join(', '));
    c.push(n(r.fact, 100));
    if (has.plan) c.push(n(r.plan, 100), n(r.lag, 100));
    if (has.money) c.push(n(r.money.portfolio));
    if (has.closed) c.push(n(r.money.closed));
    if (has.paid) c.push(n(r.money.paid));
    if (has.people) c.push(n(r.people), n(r.tech));
    if (has.remarksOpen) c.push(n(r.remarksOpen), n(r.remarksOverdue));
    if (has.forecast) c.push(r.forecast?.status === 'stalled' ? 'темпа нет' : (r.forecast?.date ?? ''), n(r.forecast?.delayDays == null ? null : -r.forecast.delayDays));
    c.push(r.curators.join(', '));
    return c;
  });
  const csv = [head, ...lines].map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${code}-объекты-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
