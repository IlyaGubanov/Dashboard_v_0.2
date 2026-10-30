import { Badge, Card, Divider, Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconArrowDownRight, IconArrowUpRight, IconTool, IconUsers } from '@tabler/icons-react';
import type { DirectionKpi, OverviewDirection } from '@mvs/shared';
import { DirectionIcon } from '../../ui/DirectionIcon';
import { FactPlanBar } from '../../ui/FactPlanBar';
import { RiskBadge, riskColor } from '../../ui/RiskBadge';
import { date, int, pct, pp, tileValue, weekLabel } from '../../ui/format';
import { ForecastLabel } from '../../ui/ForecastLabel';

export function asOfLabel(k: DirectionKpi) {
  if (!k.asOf) return 'нет данных';
  if (k.asOfKind === 'WEEK') return weekLabel(k.asOf);
  if (k.asOfKind === 'REPORT') return `отчёт ${date(k.asOf)}`;
  return `данные на ${date(k.asOf)}`;
}

const prevLabel = { WEEK: 'за неделю', DAY: 'за день', REPORT: 'к прошлому отчёту' } as const;

/** Карточка направления в сводке: готовность против плана, отстающие, ресурсы, ключевые показатели. */
export function DirectionCard({ d }: { d: OverviewDirection }) {
  const k = d.kpi;
  const delta = k.prev && k.fact != null && k.prev.fact != null ? k.fact - k.prev.fact : null;
  const barColor = k.plan == null ? 'var(--series-1)' : riskColor(k.risk);

  return (
    <Card
      withBorder
      padding="lg"
      className="card-link direction-card"
      renderRoot={(props) => <Link to="/d/$code" params={{ code: d.code }} {...props} />}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <DirectionIcon icon={d.icon} color={d.color} size={36} />
            <div>
              <Text fw={600} lh={1.2}>
                {d.shortName}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {d.name}
              </Text>
            </div>
          </Group>
          <div style={{ flexShrink: 0 }}>
            {k.plan != null ? <RiskBadge risk={k.risk} /> : <Badge variant="light" color="gray">без графика</Badge>}
          </div>
        </Group>

        <Group gap={6}>
          <Text size="xs" c="dimmed">
            {asOfLabel(k)}
          </Text>
          {!k.verified && k.asOf && (
            <Tooltip label="Отчётная точка открыта: куратор ещё не проверил и не закрыл её">
              <Badge size="xs" variant="outline" color="orange">
                не проверено
              </Badge>
            </Tooltip>
          )}
          {k.hasExamples && (
            <Tooltip label="Часть значений — демо-примеры, их нужно заменить реальными">
              <Badge size="xs" variant="outline" color="gray">
                демо
              </Badge>
            </Tooltip>
          )}
        </Group>

        <div>
          <Group justify="space-between" align="flex-end" wrap="nowrap">
            <Text fz={32} fw={700} lh={1}>
              {pct(k.fact)}
            </Text>
            {k.plan != null && (
              <div style={{ textAlign: 'right' }}>
                <Text size="sm">план {pct(k.plan)}</Text>
                <Text size="sm" fw={600}>
                  {pp(k.fact != null ? k.fact - k.plan : null)}
                </Text>
              </div>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {k.factLabel}
          </Text>
          <FactPlanBar fact={k.fact} plan={k.plan} color={barColor} label={d.shortName} />
          {delta != null && (
            <Group gap={4}>
              {delta >= 0 ? <IconArrowUpRight size={14} aria-hidden /> : <IconArrowDownRight size={14} aria-hidden />}
              <Text size="xs" c="dimmed">
                {pp(delta)} {prevLabel[k.asOfKind]}
              </Text>
            </Group>
          )}
        </div>

        <Group gap="lg">
          <Stat label={k.siteUnit} value={int(k.sites)} />
          {k.lagging != null && <Stat label="отстают" value={int(k.lagging)} />}
          {k.critical != null && <Stat label="критично" value={int(k.critical)} />}
          {k.people != null && <Stat label="людей" value={int(k.people)} icon={<IconUsers size={14} aria-hidden />} />}
          {k.tech != null && <Stat label="техники" value={int(k.tech)} icon={<IconTool size={14} aria-hidden />} />}
        </Group>

        {k.forecast && k.forecast.status !== 'nodata' && k.forecast.status !== 'done' && (
          <Group gap={6} wrap="wrap">
            <Text size="xs" c="dimmed">
              Прогноз завершения:
            </Text>
            <ForecastLabel f={k.forecast} size="xs" />
            {!!k.forecastLate && (
              <Text size="xs" c="dimmed">
                · не успевают {k.forecastLate} {k.siteUnit}
              </Text>
            )}
          </Group>
        )}

        {!!k.kpis.length && (
          <>
            <Divider />
            {/* до трёх плиток — в ряд; четыре — 2×2; пять-шесть — по три */}
            <SimpleGrid cols={k.kpis.length <= 3 ? k.kpis.length : k.kpis.length === 4 ? 2 : 3} spacing="xs">
              {k.kpis.map((t) => (
                <div key={t.key}>
                  <Text size="xs" c="dimmed" lineClamp={2} lh={1.25} mih={30}>
                    {t.label}
                  </Text>
                  <Text size="sm" fw={600}>
                    {tileValue(t)}
                  </Text>
                </div>
              ))}
            </SimpleGrid>
          </>
        )}

        {k.extra?.map((x) => (
          <Text key={x.label} size="xs" c="dimmed">
            {x.label}: {x.sites} объект(а) · отчёт {date(x.asOf)}
          </Text>
        ))}

        <Text className="card-footer" size="xs" c="dimmed">
          Куратор: {d.curators.length ? d.curators.map((c) => c.fullName).join(', ') : 'не назначен'}
        </Text>
      </Stack>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <Group gap={4} wrap="nowrap">
        {icon}
        <Text fw={600}>{value}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </div>
  );
}
