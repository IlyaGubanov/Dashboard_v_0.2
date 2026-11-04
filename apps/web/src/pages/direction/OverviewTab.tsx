import { useState } from 'react';
import { Alert, Badge, Box, Button, Card, Grid, Group, Modal, ScrollArea, SimpleGrid, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { DirectionKpi, SiteKpiRow } from '@mvs/shared';
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
import { TileDetailDrawer, type OpenTile } from './TileDetailDrawer';

/** Сколько объектов показывать в обзоре; остальные — во вкладке «Объекты». */
const SITES_SHOWN = 12;

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
      <KpiHeader k={k} code={code} date={date} rows={rows} onOpenSite={onOpenSite} />
      {code === 'networks' && <NetworkLayingCard rows={k.networkLaying} />}
      <SitesList code={code} rows={rows} hasPlan={k.plan != null} onOpenSite={onOpenSite} onShowSites={onShowSites} />
      <SectionsTable rows={rows} hasPlan={k.plan != null} />
    </Stack>
  );
}

/** Главные показатели направления на дату среза. */
function KpiHeader({ k, code, date, rows, onOpenSite }: { k: DirectionKpi; code: string; date?: string; rows: SiteKpiRow[]; onOpenSite: (id: number) => void }) {
  const [detail, setDetail] = useState<'volume' | 'status' | null>(null);
  const [openTile, setOpenTile] = useState<OpenTile | null>(null);
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
  // на плитке подпись строчными; в заголовке панели — как в настройке («Заключения МГЭ»)
  const tileTitle = (key: string, label: string) => {
    const source = k.kpis.find((x, i) => `kpi:${x.slot ?? i}` === key)?.label;
    return source && source.toLowerCase() === label ? source : label[0].toUpperCase() + label.slice(1);
  };
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
              </Tooltip> : <UnstyledButton key={t.key} className="tile-button" aria-label={`${t.label}: ${t.value}. Показать подробности`} onClick={() => setOpenTile({ key: t.key, title: tileTitle(t.key, t.label), value: t.value })} style={{ width: '100%', minWidth: 0 }}>
                <Metric label={t.label} value={t.value} color={t.color} />
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Grid.Col>
      </Grid>
    </Card>
    <TileDetailDrawer tile={openTile} code={code} tileDate={date} rows={rows} onClose={() => setOpenTile(null)} onOpenSite={onOpenSite} />
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

/** Перечень объектов направления: сначала самые отстающие, щелчок открывает карточку. */
function SitesList({ code, rows, hasPlan, onOpenSite, onShowSites }: { code: string; rows: SiteKpiRow[]; hasPlan: boolean; onOpenSite: (id: number) => void; onShowSites: () => void }) {
  const { data: dirs } = useQuery(directionsQuery);
  const title = dirs?.find((d) => d.code === code)?.shortName ?? 'Объекты';
  const sorted = [...rows].sort((a, b) => (hasPlan ? (a.lag ?? Infinity) - (b.lag ?? Infinity) : 0) || (a.fact ?? Infinity) - (b.fact ?? Infinity));
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <div>
          <Text fw={600}>{title}</Text>
          <Text size="xs" c="dimmed">
            {hasPlan ? 'Сначала самые отстающие. ' : ''}Щелчок открывает карточку
          </Text>
        </div>
        <Button variant="subtle" size="compact-sm" onClick={onShowSites} style={{ flexShrink: 0 }}>
          {rows.length > SITES_SHOWN ? `Весь реестр · ${int(rows.length)} →` : 'Весь реестр →'}
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Объект</Table.Th>
              <Table.Th w="28%">{hasPlan ? 'Факт и план' : 'Выполнение'}</Table.Th>
              {hasPlan && <Table.Th ta="right">Отставание</Table.Th>}
              <Table.Th ta="right">Люди</Table.Th>
              <Table.Th ta="right">Техника</Table.Th>
              <Table.Th w={24} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sorted.slice(0, SITES_SHOWN).map((r) => (
              <Table.Tr key={r.id} className="row-link" tabIndex={0} role="link" aria-label={`Открыть карточку: ${r.shortName}`} onClick={() => onOpenSite(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenSite(r.id); }}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {r.shortName}
                  </Text>
                  <Box mt={2}>
                    <RiskBadge risk={r.risk} size="xs" />
                  </Box>
                </Table.Td>
                <Table.Td>
                  <FactPlanBar fact={r.fact} plan={r.plan} color={r.plan == null ? 'var(--series-1)' : riskColor(r.risk)} height={7} />
                  <Text size="xs" c="dimmed" mt={2}>
                    {pct(r.fact, 0)}
                    {r.plan != null ? ` · план ${pct(r.plan, 0)}` : ''}
                  </Text>
                </Table.Td>
                {hasPlan && <Table.Td ta="right">{r.lag != null ? <Lag v={r.lag} crit={r.risk === 'crit'} /> : '—'}</Table.Td>}
                <Table.Td ta="right">{int(r.people)}</Table.Td>
                <Table.Td ta="right">{int(r.tech)}</Table.Td>
                <Table.Td>
                  <IconChevronRight size={15} color="var(--status-none)" aria-hidden />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
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
