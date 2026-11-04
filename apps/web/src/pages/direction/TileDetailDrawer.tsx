import { useState } from 'react';
import { Alert, Box, Drawer, Group, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCircleCheck, IconCircleDashed } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { KpiTileDetail, MachineryStatus, SiteKpiRow, SiteRisk } from '@mvs/shared';
import { directionQueries } from '../../api';
import { FactPlanBar } from '../../ui/FactPlanBar';
import { date, int, money, pct, tileValue } from '../../ui/format';
import { Lag } from '../../ui/Lag';
import { RiskBadge, riskColor } from '../../ui/RiskBadge';
import { MachineryFilter, MachineryList, MachineryWithoutSite, machineryMatch } from './MachineryCompare';

/** Плитка, по которой открыта панель. */
export interface OpenTile {
  key: string;
  /** заголовок панели */
  title: string;
  value: string;
}

/** Что считает показатель — простыми словами, для шапки панели. */
const HELP: Record<string, string> = {
  scheduleLagDays: 'Сколько дней назад план был равен сегодняшнему факту. Чем больше число, тем дальше направление от графика.',
  trackerOverdue: 'Плановая дата уже прошла, а этап не завершён.',
  trackerStatusDone: 'Статус этапа по каждому объекту.',
  toPay: 'Принято по КС-2, но ещё не оплачено.',
  overdueItems: 'Позиции с истёкшим сроком, которые не выполнены.',
  remarksOpen: 'Замечания, которые ещё не приняты и не сняты.',
  remarksOverdue: 'Незакрытые замечания с прошедшим сроком.',
  forecastLate: 'Объекты, которые при текущем темпе не успевают к сроку.',
};

const RISK_FILTER: Record<string, SiteRisk[] | null> = {
  sites: null,
  lagging: ['warn', 'crit'],
  critical: ['crit'],
  done: ['done'],
};

const byLag = (a: SiteKpiRow, b: SiteKpiRow) => (a.lag ?? Infinity) - (b.lag ?? Infinity) || (a.fact ?? 0) - (b.fact ?? 0);

/** Объект с готовностью и отставанием: щелчок открывает его карточку. */
function SiteProgressRow({ r, onOpen }: { r: SiteKpiRow; onOpen: (id: number) => void }) {
  return (
    <UnstyledButton className="row-link" px={6} py={8} onClick={() => onOpen(r.id)} style={{ width: '100%' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" mb={4}>
        <Text size="sm" fw={500} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {r.shortName}
        </Text>
        <Box style={{ textAlign: 'right', flexShrink: 0 }}>{r.lag != null && <Lag v={r.lag} crit={r.risk === 'crit'} />}</Box>
      </Group>
      <FactPlanBar fact={r.fact} plan={r.plan} color={r.plan == null ? 'var(--series-1)' : riskColor(r.risk)} height={7} />
      <Group justify="space-between" mt={4}>
        <Text size="xs" c="dimmed">
          факт {pct(r.fact, 0)}
          {r.plan != null ? ` · план ${pct(r.plan, 0)}` : ''}
        </Text>
        <RiskBadge risk={r.risk} size="xs" />
      </Group>
    </UnstyledButton>
  );
}

/** Строка «объект — значение» с полосой доли от максимума. */
function ValueRow({ name, value, sub, share, onOpen }: { name: string; value: string; sub?: string; share: number; onOpen: () => void }) {
  return (
    <UnstyledButton className="row-link" px={6} py={8} onClick={onOpen} style={{ width: '100%' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" mb={4}>
        <Text size="sm" fw={500} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {name}
        </Text>
        <Text size="sm" fw={700} style={{ flexShrink: 0 }}>
          {value}
        </Text>
      </Group>
      <Box style={{ height: 5, borderRadius: 3, background: 'var(--surface-muted)' }}>
        <Box style={{ height: '100%', width: `${Math.max(2, share * 100)}%`, borderRadius: 3, background: 'var(--series-1)' }} />
      </Box>
      {sub && (
        <Text size="xs" c="dimmed" mt={4}>
          {sub}
        </Text>
      )}
    </UnstyledButton>
  );
}

function Empty() {
  return <Text c="dimmed">Объектов в этой выборке нет.</Text>;
}

function ValueList({ rows, format, onOpen }: { rows: { id: number; name: string; value: number; sub?: string }[]; format: (v: number) => string; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Stack gap={2}>
      {[...rows]
        .sort((a, b) => b.value - a.value)
        .map((r) => (
          <ValueRow key={r.id} name={r.name} value={format(r.value)} sub={r.sub} share={r.value / max} onOpen={() => onOpen(r.id)} />
        ))}
    </Stack>
  );
}

/** Техника: что внёс ответственный, что распределено в РЭБ, где не сходится. */
function MachineryDetail({ code, tileDate, onOpen }: { code: string; tileDate?: string; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState<MachineryStatus | 'issues' | 'all'>('all');
  const { data, error } = useQuery(directionQueries.machinery(code, tileDate));
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={240} />;
  const rows = data.rows.filter((r) => r.status !== 'none' || r.reported.total != null);
  const canCompare = rows.some((r) => r.status != null);
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {canCompare ? 'Сравнение данных ответственного за объект с распределением РЭБ.' : 'Техника по данным ответственного за объект.'}
        {data.asOf ? ` На ${date(data.asOf)}.` : ''}
      </Text>
      {canCompare && <MachineryFilter summary={data.summary} value={filter} onChange={setFilter} />}
      <MachineryWithoutSite n={data.fleetWithoutSite} />
      <MachineryList rows={rows.filter((r) => machineryMatch(r, filter))} onOpenSite={(r) => onOpen(r.siteId)} />
    </Stack>
  );
}

/** Надстройка: просроченные строки этапа или статус этапа по объектам. */
function TrackerDetail({ code, detail, onOpen }: { code: string; detail: KpiTileDetail; onOpen: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.trackers(code));
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={200} />;
  const tracker = data.trackers.find((t) => t.code === detail.tracker?.code);
  const stage = tracker?.stages.find((s) => s.code === detail.tracker?.stage);
  if (!tracker || !stage) return <Empty />;
  if (detail.key === 'trackerOverdue') {
    const rows = tracker.rows
      .filter((r) => r.planDate != null && detail.planDate != null && r.planDate < detail.planDate && Number(r.values[stage.code] ?? 0) < 100)
      .sort((a, b) => a.planDate!.localeCompare(b.planDate!));
    if (!rows.length) return <Empty />;
    return (
      <Stack gap={2}>
        {rows.map((r) => (
          <UnstyledButton key={`${r.siteId}:${r.item.code}`} className="row-link" px={6} py={8} onClick={() => onOpen(r.siteId)} style={{ width: '100%' }}>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Text size="sm" fw={500} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {r.item.name}
              </Text>
              <Text size="sm" fw={700} style={{ flexShrink: 0, color: 'var(--status-critical)' }}>
                {date(r.planDate)}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {r.siteName}
              {r.qty != null ? ` · ${int(r.qty)}${r.unit ? ` ${r.unit}` : ''}` : ''} · {stage.name.toLowerCase()}: {int(Number(r.values[stage.code] ?? 0))} %
            </Text>
          </UnstyledButton>
        ))}
      </Stack>
    );
  }
  const dates = tracker.stages.filter((s) => s.valueType === 'DATE');
  const rows = [...tracker.rows].sort((a, b) => a.siteName.localeCompare(b.siteName, 'ru'));
  if (!rows.length) return <Empty />;
  return (
    <Stack gap={2}>
      {rows.map((r) => {
        const value = r.values[stage.code];
        const option = stage.options?.find((o) => o.value === value);
        const shown = dates.flatMap((s) => (r.values[s.code] ? [`${s.name}: ${date(String(r.values[s.code]))}`] : []));
        return (
          <UnstyledButton key={`${r.siteId}:${r.item.code}`} className="row-link" px={6} py={8} onClick={() => onOpen(r.siteId)} style={{ width: '100%' }}>
            <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
              {r.siteName}
            </Text>
            <Group gap={4} wrap="nowrap" mt={2}>
              {option?.done ? <IconCircleCheck size={15} color="var(--status-good)" aria-hidden style={{ flexShrink: 0 }} /> : <IconCircleDashed size={15} color="var(--status-none)" aria-hidden style={{ flexShrink: 0 }} />}
              <Text size="sm">{option?.label ?? (value == null ? 'нет данных' : String(value))}</Text>
            </Group>
            {shown.length > 0 && (
              <Text size="xs" c="dimmed" mt={2}>
                {shown.join(' · ')}
              </Text>
            )}
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}

/** Показатель из настроек направления: значения по объектам с сервера. */
function MetricDetail({ code, slot, tileDate, rows, onOpen }: { code: string; slot: number; tileDate?: string; rows: SiteKpiRow[]; onOpen: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.tile(code, slot, tileDate));
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={200} />;
  const help = HELP[data.key];
  return (
    <Stack gap="sm">
      {help && (
        <Text size="sm" c="dimmed">
          {help}
        </Text>
      )}
      {data.key === 'scheduleLagDays' ? (
        <Stack gap={2}>
          {[...rows].sort(byLag).map((r) => (
            <SiteProgressRow key={r.id} r={r} onOpen={onOpen} />
          ))}
        </Stack>
      ) : data.tracker && data.key.startsWith('tracker') ? (
        <TrackerDetail code={code} detail={data} onOpen={onOpen} />
      ) : (
        <ValueList
          rows={data.rows.map((r) => ({ id: r.siteId, name: r.siteName, value: r.value }))}
          format={(value) => tileValue({ key: data.key, label: data.label, format: data.format, unit: data.unit, value })}
          onOpen={onOpen}
        />
      )}
    </Stack>
  );
}

/** Панель справа: из чего складывается значение плитки. Страница за ней остаётся видна. */
export function TileDetailDrawer({
  tile,
  code,
  tileDate,
  rows,
  onClose,
  onOpenSite,
}: {
  tile: OpenTile | null;
  code: string;
  tileDate?: string;
  rows: SiteKpiRow[];
  onClose: () => void;
  onOpenSite: (id: number) => void;
}) {
  const open = (id: number) => {
    onClose();
    onOpenSite(id);
  };
  const key = tile?.key ?? '';
  const slot = key.startsWith('kpi:') ? Number(key.slice(4)) : null;
  const risk = RISK_FILTER[key];
  const moneyValue = (r: SiteKpiRow) => (key === 'portfolio' ? r.money.portfolio : key === 'closed' ? r.money.closed : r.money.paid);
  return (
    <Drawer className="direction-page" opened={!!tile} onClose={onClose} position="right" size="min(520px, 100%)" zIndex={200} title={tile && <Text fw={600}>{tile.title}: {tile.value}</Text>}>
      {!tile ? null : slot != null ? (
        <MetricDetail code={code} slot={slot} tileDate={tileDate} rows={rows} onOpen={open} />
      ) : key === 'tech' ? (
        <MachineryDetail code={code} tileDate={tileDate} onOpen={open} />
      ) : key === 'people' ? (
        <ValueList rows={rows.flatMap((r) => (r.people ? [{ id: r.id, name: r.shortName, value: r.people }] : []))} format={int} onOpen={open} />
      ) : key === 'portfolio' || key === 'closed' || key === 'paid' ? (
        <ValueList
          rows={rows.flatMap((r) => {
            const value = moneyValue(r);
            const share = key !== 'portfolio' && value != null && r.money.portfolio ? `${pct(value / r.money.portfolio, 0)} из ${money(r.money.portfolio)}` : undefined;
            return value ? [{ id: r.id, name: r.shortName, value, sub: share }] : [];
          })}
          format={money}
          onOpen={open}
        />
      ) : (
        <SiteList rows={risk ? rows.filter((r) => risk.includes(r.risk)) : rows} onOpen={open} />
      )}
    </Drawer>
  );
}

function SiteList({ rows, onOpen }: { rows: SiteKpiRow[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty />;
  return (
    <Stack gap={2}>
      {[...rows].sort(byLag).map((r) => (
        <SiteProgressRow key={r.id} r={r} onOpen={onOpen} />
      ))}
    </Stack>
  );
}
