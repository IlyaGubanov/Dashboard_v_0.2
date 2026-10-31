import { useState } from 'react';
import { Alert, Badge, Box, Button, Card, Grid, Group, Modal, ScrollArea, SimpleGrid, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { SITE_RISK_LABELS, type DirectionKpi, type SiteKpiRow, type SiteRisk } from '@mvs/shared';
import { directionQueries, directionsQuery } from '../../api';
import { useAppearance } from '../../ui/appearance';
import { arrangeTiles } from '../../ui/overviewTiles';
import { Metric } from '../../ui/Metric';
import { FactPlanBar } from '../../ui/FactPlanBar';
import { RiskBadge, riskColor } from '../../ui/RiskBadge';
import { int, money, pct, pp, tileValue } from '../../ui/format';
import { Lag } from '../../ui/Lag';
import { useFinanceHidden } from '../../ui/finance';
import { asOfLabel } from '../overview/DirectionCard';
import { NetworkLayingCard } from './NetworkLayingCard';

const RISK_ORDER: SiteRisk[] = ['crit', 'warn', 'ok', 'done', 'wait', 'na'];

export function OverviewTab({
  code,
  date,
  onOpenSite,
  onShowSites,
}: {
  code: string;
  date?: string;
  onOpenSite: (id: number) => void;
  onShowSites: () => void;
}) {
  const kpi = useQuery(directionQueries.kpi(code, date));
  const sites = useQuery(directionQueries.sites(code, date));
  if (kpi.error) return <Alert color="red">{(kpi.error as Error).message}</Alert>;
  if (!kpi.data || !sites.data) return <Skeleton h={400} />;
  const k = kpi.data;
  const rows = sites.data;

  return (
    <Stack>
      <KpiHeader k={k} onOpenSite={onOpenSite} />
      {code === 'networks' && <NetworkLayingCard rows={k.networkLaying} />}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Stack>
            <RiskDistribution rows={rows} onShowSites={onShowSites} />
            <SectionsTable rows={rows} hasPlan={k.plan != null} />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Card withBorder padding="lg">
            <Text fw={600}>{k.plan != null ? 'Наибольшее отставание от графика' : 'Наименьшая доля выполненных позиций'}</Text>
            <Text size="xs" c="dimmed" mb="sm">
              Щелчок открывает карточку объекта
            </Text>
            <Stack gap={2}>
              {(k.plan != null
                ? rows.filter((r) => r.lag != null && (r.risk === 'warn' || r.risk === 'crit')).sort((a, b) => a.lag! - b.lag!)
                : rows.filter((r) => r.fact != null && r.fact < 0.995).sort((a, b) => a.fact! - b.fact!)
              )
                .slice(0, 12)
                .map((r) => (
                  <UnstyledButton key={r.id} className="row-link" px={6} py={6} onClick={() => onOpenSite(r.id)}>
                    <Group justify="space-between" wrap="nowrap">
                      <Box style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {r.shortName}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {r.section ? `${r.section.name} · ` : ''}факт {pct(r.fact, 0)}
                          {r.plan != null ? ` · план ${pct(r.plan, 0)}` : ''}
                          {r.overdueItems ? ` · просрочено позиций: ${r.overdueItems}` : ''}
                        </Text>
                      </Box>
                      <Box style={{ textAlign: 'right', flexShrink: 0 }}>
                        {r.lag != null && (
                          <div>
                            <Lag v={r.lag} crit={r.risk === 'crit'} />
                          </div>
                        )}
                        <RiskBadge risk={r.risk} size="xs" />
                      </Box>
                    </Group>
                  </UnstyledButton>
                ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/** Главные показатели направления на дату среза. */
function KpiHeader({ k, onOpenSite }: { k: DirectionKpi; onOpenSite: (id: number) => void }) {
  const [detail, setDetail] = useState<'volume' | 'status' | null>(null);
  const report = k.reportPrograms?.find(p => p.periodId === k.periodId);
  const statusMetric = k.kpis.find(t => t.key === 'reportStatusCount');
  const statusKey = statusMetric ? `kpi:${statusMetric.slot ?? k.kpis.indexOf(statusMetric)}` : 'report-status';
  const details = report?.rows.filter(r => detail === 'volume' ? r.volumeDone : r.statusDone) ?? [];
  const delta = k.prev && k.fact != null && k.prev.fact != null ? k.fact - k.prev.fact : null;
  const financeHidden = useFinanceHidden();
  const m = financeHidden ? null : k.money;
  const { data: dirs } = useQuery(directionsQuery);
  const { appearance } = useAppearance();
  const cols = appearance.tiles.columns;
  // все возможные плитки; какие показывать, порядок, подписи и цвета — «Плитки обзора» в конструкторе направления
  const tiles = arrangeTiles(
    [
      { key: 'sites', label: k.siteUnit, value: int(k.sites) },
      ...(k.lagging != null ? [{ key: 'lagging', label: 'отстают от графика', value: int(k.lagging) }] : []),
      ...(k.critical != null ? [{ key: 'critical', label: 'критично', value: int(k.critical) }] : []),
      { key: 'done', label: report ? 'Выполнено по объёмам' : 'выполнено', value: report ? (report.volumeTotal ? `${report.volumeDone} из ${report.volumeTotal}` : '—') : int(k.done) },
      ...(report && !statusMetric ? [{ key: statusKey, label: 'Завершено по отчётному статусу', value: report.statusTotal ? `${report.statusDone} из ${report.statusTotal}` : '—' }] : []),
      ...(k.people != null ? [{ key: 'people', label: 'людей на объектах', value: int(k.people) }] : []),
      ...(k.tech != null ? [{ key: 'tech', label: 'техники', value: int(k.tech) }] : []),
      ...(m?.portfolio != null ? [{ key: 'portfolio', label: m.portfolioLabel.toLowerCase(), value: money(m.portfolio) }] : []),
      ...(m?.closed != null ? [{ key: 'closed', label: 'закрыто по КС-2', value: money(m.closed) }] : []),
      ...(m?.paid != null ? [{ key: 'paid', label: 'оплачено', value: money(m.paid) }] : []),
      ...k.kpis
        .map((t, i) => ({ ...t, slot: t.slot ?? i }))
        .filter((t) => !(financeHidden && t.format === 'money') && !(t.key === 'peopleTotal' && k.people != null))
        .map((t) => ({ key: `kpi:${t.slot}`, label: report && t.key === 'reportStatusCount' ? 'Завершено по отчётному статусу' : t.label.toLowerCase(), value: report && t.key === 'reportStatusCount' ? (report.statusTotal ? `${report.statusDone} из ${report.statusTotal}` : '—') : tileValue(t) })),
    ],
    dirs?.find((d) => d.code === k.code)?.overviewTiles,
  );
  return (
    <><Card withBorder padding="lg">
      <Grid gutter="lg" align="center">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Group gap={6} mb={4}>
            <Text size="sm" c="dimmed">
              {asOfLabel(k)}
              {k.planDate && k.planDate !== k.asOf ? ` · план на ${k.planDate.split('-').reverse().join('.')}` : ''}
            </Text>
            {!k.verified && k.asOf && (
              <Badge size="xs" variant="outline" color="orange">
                не проверено куратором
              </Badge>
            )}
          </Group>
          <Group justify="space-between" align="flex-end">
            <Text fz="calc(40px * var(--text-scale, 1))" fw={700} lh={1}>
              {pct(k.fact)}
            </Text>
            {k.plan != null && (
              <div style={{ textAlign: 'right' }}>
                <Text>план {pct(k.plan)}</Text>
                <Lag v={k.fact != null ? k.fact - k.plan : null} crit={k.risk === 'crit'} size="md" />
              </div>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {k.factLabel}
          </Text>
          <FactPlanBar fact={k.fact} plan={k.plan} color={k.plan == null ? 'var(--series-1)' : riskColor(k.risk)} height={12} />
          <Group justify="space-between">
            {k.plan != null ? <RiskBadge risk={k.risk} /> : <span />}
            {delta != null && (
              <Text size="xs" c="dimmed">
                {pp(delta)} к {k.prev!.asOf.split('-').reverse().join('.')}
              </Text>
            )}
          </Group>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <SimpleGrid cols={{ base: 2, sm: Math.min(cols, 4), xl: cols }} spacing="md">
            {tiles.map((t) => (
              report && (t.key === 'done' || t.key === statusKey) ? <Tooltip key={t.key} label={t.key === 'done' ? report.volumeMethod : report.statusMethod} multiline w={320} withArrow>
                <UnstyledButton aria-label={`${t.label}: ${t.value}`} onClick={() => setDetail(t.key === 'done' ? 'volume' : 'status')} style={{ width: '100%', minWidth: 0 }}>
                  <Metric label={t.label} value={t.value} color={t.color} />
                </UnstyledButton>
              </Tooltip> : <Metric key={t.key} label={t.label} value={t.value} color={t.color} />
            ))}
          </SimpleGrid>
        </Grid.Col>
      </Grid>
    </Card>
    <Modal className="direction-page" opened={detail !== null} onClose={() => setDetail(null)} title={detail === 'volume' ? 'Выполнено по объёмам' : 'Завершено по отчётному статусу'} size="lg" zIndex={400}>
      <Stack gap="sm"><Text size="sm" c="dimmed">{report?.name} · {report?.asOf.split('-').reverse().join('.')}</Text>
        <Text size="sm">{detail === 'volume' ? report?.volumeMethod : report?.statusMethod}</Text>
        {details.length ? <ScrollArea.Autosize mah="55vh"><Table.ScrollContainer minWidth={300}><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Объект</Table.Th><Table.Th>Отчётный статус</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{details.map(row => <Table.Tr key={row.id}>
          <Table.Td><UnstyledButton onClick={() => { setDetail(null); onOpenSite(row.id); }} style={{ color: 'var(--mantine-primary-color-filled)', overflowWrap: 'anywhere' }}>{row.name}</UnstyledButton></Table.Td><Table.Td style={{ whiteSpace: 'normal' }}>{row.statusText || '—'}</Table.Td>
        </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></ScrollArea.Autosize> : <Text c="dimmed">Объектов в этой выборке нет.</Text>}
      </Stack>
    </Modal></>
  );
}

/** Сколько объектов в каждом состоянии — одна полоса, доли подписаны. */
function RiskDistribution({ rows, onShowSites }: { rows: SiteKpiRow[]; onShowSites: () => void }) {
  const counts = RISK_ORDER.map((r) => ({ risk: r, n: rows.filter((x) => x.risk === r).length })).filter((x) => x.n);
  const total = rows.length || 1;
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Объекты по состоянию</Text>
        <Button variant="subtle" size="compact-sm" onClick={onShowSites}>
          Весь реестр →
        </Button>
      </Group>
      <Box style={{ display: 'flex', gap: 2, height: 14 }}>
        {counts.map((c) => (
          <Tooltip key={c.risk} label={`${SITE_RISK_LABELS[c.risk]}: ${c.n} (${pct(c.n / total, 0)})`} withArrow>
            <Box style={{ flex: c.n, background: riskColor(c.risk), borderRadius: 4, minWidth: 4 }} />
          </Tooltip>
        ))}
      </Box>
      <Group gap="lg" mt="sm">
        {counts.map((c) => (
          <Group key={c.risk} gap={6} wrap="nowrap">
            <RiskBadge risk={c.risk} size="xs" />
            <Text size="xs" fw={600}>
              {c.n}
            </Text>
          </Group>
        ))}
      </Group>
    </Card>
  );
}

/** Разбивка по разделам / лотам. */
function SectionsTable({ rows, hasPlan }: { rows: SiteKpiRow[]; hasPlan: boolean }) {
  const groups = new Map<string, SiteKpiRow[]>();
  for (const r of rows) {
    const k = r.section?.name ?? 'Без раздела';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  if (groups.size < 2) return null;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return (
    <Card withBorder padding="lg">
      <Text fw={600} mb="sm">
        По разделам
      </Text>
      <Table.ScrollContainer minWidth={420}>
        <Table verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' }, th: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Раздел</Table.Th>
              <Table.Th ta="right">Объектов</Table.Th>
              <Table.Th ta="right">Средняя готовность</Table.Th>
              {hasPlan && <Table.Th ta="right">Отстают</Table.Th>}
              {hasPlan && <Table.Th ta="right">Критично</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...groups].map(([name, rs]) => (
              <Table.Tr key={name}>
                <Table.Td>{name}</Table.Td>
                <Table.Td ta="right">{rs.length}</Table.Td>
                <Table.Td ta="right">{pct(avg(rs.map((r) => r.fact)))}</Table.Td>
                {hasPlan && <Table.Td ta="right">{rs.filter((r) => r.risk === 'warn' || r.risk === 'crit').length}</Table.Td>}
                {hasPlan && <Table.Td ta="right">{rs.filter((r) => r.risk === 'crit').length}</Table.Td>}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
