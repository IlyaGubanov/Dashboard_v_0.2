import { useMemo, useState } from 'react';
import { Alert, Box, Card, Group, Select, Skeleton, Switch, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { WorkGrid } from '@mvs/shared';
import { directionQueries } from '../../api';
import { RiskBadge } from '../../ui/RiskBadge';
import { SEQ_STEPS, seq } from '../../ui/seq';
import { int, pct } from '../../ui/format';
import { Lag } from '../../ui/Lag';

type Site = WorkGrid['sites'][number];
type Item = Site['items'][number];

/** Сводная ячейка: по виду работ на объекте может быть несколько позиций (Сети: несколько линий). */
function cell(items: Item[]) {
  const live = items.filter((i) => !i.excluded);
  if (!live.length) return null;
  const fact = live.reduce((a, i) => a + i.fact, 0) / live.length;
  const withPlan = live.filter((i) => i.plan != null);
  const plan = withPlan.length ? withPlan.reduce((a, i) => a + i.plan!, 0) / withPlan.length : null;
  return { fact, plan, overdue: live.some((i) => i.overdue), items: live };
}

/**
 * Матрица «объект × вид работ»: цвет ячейки — выполнение (одна синяя шкала, темнее — больше),
 * красная метка — срок прошёл, а работа не выполнена. Щелчок по строке — карточка объекта.
 */
export function MatrixTab({ code, date, onOpenSite }: { code: string; date?: string; onOpenSite: (id: number) => void }) {
  const { data, error } = useQuery(directionQueries.grid(code, date));
  const [section, setSection] = useState<string | null>(null);
  const [lagOnly, setLagOnly] = useState(false);

  const sections = useMemo(() => [...new Set((data?.sites ?? []).map((s) => s.section).filter(Boolean))] as string[], [data]);
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;

  const sites = data.sites
    .filter((s) => !section || s.section === section)
    .filter((s) => !lagOnly || s.risk === 'warn' || s.risk === 'crit')
    .filter((s) => s.items.length);
  const types = data.workTypes;
  const groups = types.reduce<{ name: string; n: number }[]>((acc, t) => {
    const g = t.group ?? '';
    if (acc.at(-1)?.name === g) acc.at(-1)!.n++;
    else acc.push({ name: g, n: 1 });
    return acc;
  }, []);
  const hasGroups = groups.some((g) => g.name);

  return (
    <Card withBorder padding={0}>
      <Group p="md" gap="md" wrap="wrap">
        {sections.length > 1 && <Select aria-label="Все разделы" placeholder="Все разделы" clearable data={sections} value={section} onChange={setSection} w={220} />}
        {data.planDate && <Switch label="Только отстающие объекты" checked={lagOnly} onChange={(e) => setLagOnly(e.currentTarget.checked)} />}
        <Group gap={6} ml="auto" wrap="nowrap" aria-label="Шкала выполнения: от 0 до 100 процентов">
          <Text size="xs" c="dimmed">
            0 %
          </Text>
          {SEQ_STEPS.map((s) => (
            <Box key={s} w={18} h={12} style={{ borderRadius: 2, background: `var(--seq-${s})` }} />
          ))}
          <Text size="xs" c="dimmed">
            100 %
          </Text>
          <Box w={8} h={8} ml="sm" style={{ borderRadius: 4, background: 'var(--status-critical)' }} />
          <Text size="xs" c="dimmed">
            срок прошёл
          </Text>
        </Group>
      </Group>

      <Box style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table className="matrix-table" style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 'calc(12px * var(--text-scale, 1))' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--mantine-color-body)' }}>
            {hasGroups && (
              <tr>
                <th style={stickyCol} />
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.n} style={{ fontWeight: 600, textAlign: 'left', padding: '4px 4px', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                    {g.name}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              <th style={{ ...stickyCol, textAlign: 'left', padding: 6 }}>Объект</th>
              {types.map((t) => (
                <th key={t.id} style={{ width: 64, minWidth: 64, padding: '4px 2px', verticalAlign: 'bottom', fontWeight: 500 }}>
                  <Tooltip label={`${t.name}${t.unit ? `, ${t.unit}` : ''}`}>
                    <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 auto' }}>
                      {t.name}
                    </div>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpenSite(s.id); }} onClick={() => onOpenSite(s.id)} style={{ cursor: 'pointer' }}>
                <td style={{ ...stickyCol, padding: '4px 6px' }}>
                  <Text size="xs" fw={500} lineClamp={1} maw={260}>
                    {s.name}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <RiskBadge risk={s.risk} size="xs" />
                    <Text size="xs" c="dimmed">
                      {pct(s.fact, 0)}
                    </Text>
                  </Group>
                </td>
                {types.map((t) => {
                  const c = cell(s.items.filter((i) => i.workTypeId === t.id));
                  if (!c) return <td key={t.id} style={{ background: 'var(--surface-muted)', borderRadius: 3 }} aria-label="нет работ" />;
                  const tip = (
                    <div>
                      <b>{t.name}</b>
                      {c.items.length > 1 && <div>позиций: {c.items.length}</div>}
                      <div>Факт: {pct(c.fact)}</div>
                      {c.plan != null && (
                        <div>
                          План на дату: {pct(c.plan)} <Lag v={c.fact - c.plan} size="xs" />
                        </div>
                      )}
                      {c.items.map((i) =>
                        i.planQty != null ? (
                          <div key={i.id}>
                            {c.items.length > 1 ? `${i.name}: ` : 'Объём: '}
                            {int(i.factQty)} из {int(i.planQty)} {i.unit ?? ''}
                          </div>
                        ) : null,
                      )}
                      {c.overdue && <div>Срок прошёл, работа не выполнена</div>}
                    </div>
                  );
                  return (
                    <Tooltip key={t.id} label={tip} multiline w={240} withArrow>
                      <td style={{ ...seq(c.fact), textAlign: 'center', borderRadius: 3, position: 'relative', height: 34, minWidth: 64 }}>
                        {Math.round(c.fact * 100)}
                        {c.overdue && (
                          <span
                            aria-label="срок прошёл"
                            style={{ position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: 4, background: 'var(--status-critical)', boxShadow: '0 0 0 1.5px var(--mantine-color-body)' }}
                          />
                        )}
                      </td>
                    </Tooltip>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      {!sites.length && (
        <Text c="dimmed" ta="center" p="lg">
          Нет объектов по фильтру
        </Text>
      )}
    </Card>
  );
}

const stickyCol: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: 'var(--mantine-color-body)',
  minWidth: 220,
  maxWidth: 280,
};
