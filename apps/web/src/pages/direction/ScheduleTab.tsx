import { Fragment, useMemo, useState } from 'react';
import { ActionIcon, Alert, Box, Card, Group, SegmentedControl, Skeleton, Switch, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { SiteRisk } from '@mvs/shared';
import { directionQueries } from '../../api';
import { RiskBadge, riskColor } from '../../ui/RiskBadge';
import { date, pct } from '../../ui/format';
import { Lag } from '../../ui/Lag';
import { DelayReason } from './DelayReasonField';

interface Row {
  key: string;
  name: string;
  sub: string | null;
  start: number;
  end: number;
  fact: number;
  plan: number | null;
  risk: SiteRisk | null;
  overdue: boolean;
  siteId?: number;
  workItemId?: number;
  children?: Row[];
}

const ms = (s: string | null) => (s ? Date.parse(`${s}T00:00:00Z`) : null);
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * График работ: полоса — срок (начало → окончание), заливка — выполнение, вертикальная линия — дата плана.
 * Полоса, срок которой прошёл, а работа не выполнена, обведена красным.
 */
export function ScheduleTab({ code, date: asOf, onOpenSite }: { code: string; date?: string; onOpenSite: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.grid(code, asOf));
  const [mode, setMode] = useState<'sites' | 'types'>('sites');
  const [lagOnly, setLagOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const P = ms(data?.planDate ?? null) ?? Date.now();
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    if (mode === 'types') {
      return data.workTypes
        .map((t): Row | null => {
          const its = data.sites.flatMap((s) => s.items.filter((i) => i.workTypeId === t.id && !i.excluded));
          const st = its.map((i) => ms(i.start)).filter((x): x is number => x != null);
          const en = its.map((i) => ms(i.end)).filter((x): x is number => x != null);
          if (!st.length || !en.length) return null;
          const fact = its.reduce((a, i) => a + i.fact, 0) / its.length;
          const plans = its.filter((i) => i.plan != null);
          return {
            key: `t${t.id}`,
            name: t.name,
            sub: `${t.group ? `${t.group} · ` : ''}объектов: ${new Set(data.sites.filter((s) => s.items.some((i) => i.workTypeId === t.id)).map((s) => s.id)).size}`,
            start: Math.min(...st),
            end: Math.max(...en),
            fact,
            plan: plans.length ? plans.reduce((a, i) => a + i.plan!, 0) / plans.length : null,
            risk: null,
            overdue: its.some((i) => i.overdue),
            children: data.sites.flatMap(s => s.items.filter(i => i.workTypeId === t.id && i.start && i.end && !i.excluded).map(i => ({
              key: `t${t.id}-i${i.id}`, workItemId: i.id, name: `${s.name} · ${i.name}`, sub: null,
              start: ms(i.start)!, end: ms(i.end)!, fact: i.fact, plan: i.plan, risk: null, overdue: i.overdue,
            }))),
          };
        })
        .filter((r): r is Row => !!r)
        .sort((a, b) => a.start - b.start);
    }
    return data.sites
      .filter((s) => s.start && s.end)
      .filter((s) => !lagOnly || s.risk === 'warn' || s.risk === 'crit')
      .map((s) => ({
        key: `s${s.id}`,
        siteId: s.id,
        name: s.name,
        sub: s.section,
        start: ms(s.start)!,
        end: ms(s.end)!,
        fact: s.fact ?? 0,
        plan: s.plan,
        risk: s.risk,
        overdue: ms(s.end)! < P && (s.fact ?? 0) < 0.995,
        children: s.items
          .filter((i) => i.start && i.end && !i.excluded)
          .map((i) => ({
            key: `i${i.id}`,
            workItemId: i.id,
            name: i.name,
            sub: null,
            start: ms(i.start)!,
            end: ms(i.end)!,
            fact: i.fact,
            plan: i.plan,
            risk: null,
            overdue: i.overdue,
          })),
      }))
      .sort((a, b) => a.start - b.start);
  }, [data, mode, lagOnly, P]);

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;
  if (!rows.length) return <Alert color="gray">У объектов направления нет плановых сроков — график работ не строится.</Alert>;

  const all = rows.flatMap((r) => [r, ...(r.children ?? [])]);
  const min = Math.min(...all.map((r) => r.start), P);
  const max = Math.max(...all.map((r) => r.end), P);
  const span = max - min || 1;
  const x = (t: number) => ((t - min) / span) * 100;

  // деления по месяцам
  const ticks: { t: number; label: string }[] = [];
  const d = new Date(min);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const totalMonths = span / (30 * 86_400_000);
  const step = totalMonths > 24 ? 3 : totalMonths > 12 ? 2 : 1;
  let year = -1;
  for (; d.getTime() <= max; d.setUTCMonth(d.getUTCMonth() + step)) {
    // год подписывается у первого деления и при каждой смене года
    const y = d.getUTCFullYear();
    ticks.push({ t: d.getTime(), label: `${MONTHS[d.getUTCMonth()]}${y !== year ? ` ${y}` : ''}` });
    year = y;
  }

  const bar = (r: Row, child = false) => {
    const color = r.risk ? (r.plan == null ? 'var(--series-1)' : riskColor(r.risk)) : 'var(--series-1)';
    const tip = (
      <div>
        <b>{r.name}</b>
        <div>
          Срок: {date(new Date(r.start).toISOString())} — {date(new Date(r.end).toISOString())}
        </div>
        <div>Выполнено: {pct(r.fact)}</div>
        {r.plan != null && (
          <div>
            План на дату: {pct(r.plan)} <Lag v={r.fact - r.plan} size="xs" />
          </div>
        )}
        {r.overdue && <div>Срок прошёл, работа не выполнена</div>}
      </div>
    );
    return (
      <Tooltip label={tip} multiline w={260} withArrow>
        <Box
          style={{
            position: 'absolute',
            left: `${x(r.start)}%`,
            width: `${Math.max(0.4, x(r.end) - x(r.start))}%`,
            top: child ? 7 : 6,
            height: child ? 10 : 14,
            borderRadius: 4,
            background: 'var(--track)',
            outline: r.overdue ? '2px solid var(--status-critical)' : undefined,
            overflow: 'hidden',
          }}
        >
          <Box style={{ width: `${r.fact * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
        </Box>
      </Tooltip>
    );
  };

  return (
    <Card withBorder padding={0}>
      <Group p="md" gap="md" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as 'sites' | 'types')}
          data={[
            { value: 'sites', label: 'По объектам' },
            { value: 'types', label: 'По видам работ' },
          ]}
        />
        {mode === 'sites' && data.planDate && (
          <Switch label="Только отстающие" checked={lagOnly} onChange={(e) => setLagOnly(e.currentTarget.checked)} />
        )}
        <Group gap="md" ml="auto">
          <Group gap={6}>
            <Box w={2} h={14} style={{ background: 'var(--plan-mark)' }} />
            <Text size="xs" c="dimmed">
              дата плана {data.planDate ? date(data.planDate) : ''}
            </Text>
          </Group>
          <Group gap={6}>
            <Box w={18} h={10} style={{ borderRadius: 3, outline: '2px solid var(--status-critical)', background: 'var(--track)' }} />
            <Text size="xs" c="dimmed">
              срок прошёл
            </Text>
          </Group>
        </Group>
      </Group>

      <Box style={{ overflowX: 'auto' }}>
        <Box miw={900} px="md" pb="md">
          {/* шкала месяцев */}
          <Box style={{ display: 'grid', gridTemplateColumns: '300px 1fr', position: 'sticky', top: 0 }}>
            <div />
            <Box pos="relative" h={22} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              {ticks.map((t) => (
                <Text key={t.t} size="xs" c="dimmed" pos="absolute" style={{ left: `${x(t.t)}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                  {t.label}
                </Text>
              ))}
            </Box>
          </Box>
          <Box pos="relative">
            {/* сетка месяцев и линия даты плана поверх всех строк */}
            <Box pos="absolute" top={0} bottom={0} left={300} right={0} style={{ pointerEvents: 'none' }}>
              {ticks.map((t) => (
                <Box key={t.t} pos="absolute" top={0} bottom={0} style={{ left: `${x(t.t)}%`, borderLeft: '1px dashed var(--mantine-color-default-border)' }} />
              ))}
              <Box pos="absolute" top={0} bottom={0} style={{ left: `${x(P)}%`, width: 2, background: 'var(--plan-mark)', zIndex: 1 }} />
            </Box>
            {rows.map((r) => {
              const isOpen = open.has(r.key);
              return (
                <Fragment key={r.key}>
                  <Box style={{ display: 'grid', gridTemplateColumns: '300px 1fr', alignItems: 'center', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                    <Group gap={4} wrap="nowrap" py={4} pr="sm" style={{ minWidth: 0 }}>
                      {r.children?.length ? (
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={isOpen ? 'Свернуть работы' : 'Показать работы'}
                          onClick={() => setOpen((o) => (o.has(r.key) ? new Set([...o].filter((k) => k !== r.key)) : new Set([...o, r.key])))}
                        >
                          {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </ActionIcon>
                      ) : (
                        <Box w={22} />
                      )}
                      <Box style={{ minWidth: 0, cursor: r.siteId ? 'pointer' : undefined }} onClick={() => r.siteId && onOpenSite(r.siteId)}>
                        <Text size="xs" fw={500} truncate>
                          {r.name}
                        </Text>
                        <Group gap={6} wrap="nowrap">
                          {r.risk && <RiskBadge risk={r.risk} size="xs" />}
                          <Text size="xs" c="dimmed" truncate>
                            {pct(r.fact, 0)}
                            {r.sub ? ` · ${r.sub}` : ''}
                          </Text>
                        </Group>
                      </Box>
                    </Group>
                    <Box pos="relative" h={28}>
                      {bar(r)}
                    </Box>
                  </Box>
                  {isOpen &&
                    r.children!.map((c) => (
                      <Box key={c.key} style={{ background: 'var(--surface-muted)' }}>
                      <Box style={{ display: 'grid', gridTemplateColumns: '300px 1fr', alignItems: 'center' }}>
                        <Text size="xs" pl={34} pr="sm" truncate>
                          {c.name} · {pct(c.fact, 0)}
                        </Text>
                        <Box pos="relative" h={24}>
                          {bar(c, true)}
                        </Box>
                      </Box>
                      <Box pl={34} pb="xs" maw={600}><DelayReason code={code} date={asOf} workItemId={c.workItemId!} /></Box>
                      </Box>
                    ))}
                </Fragment>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Card>
  );
}
