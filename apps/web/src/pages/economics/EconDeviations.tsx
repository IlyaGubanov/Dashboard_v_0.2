import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Paper, SegmentedControl, Select, SimpleGrid, Skeleton, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertOctagon, IconClockExclamation } from '@tabler/icons-react';
import {
  ECON_CAUSES,
  ECON_DECISIONS,
  ECON_DEVIATION_KIND_LABELS,
  ECON_DEVIATION_STATUS_LABELS,
  econCauseLabel,
  econDecisionLabel,
  econDefaultMonth,
  econDeviationActive,
  econDeviationCreateSchema,
  econDeviationUpdateSchema,
  econIsCompanyKind,
  econMonthLabel,
  type EconDeviationItem,
  type EconDeviationRecord,
  type EconDeviationStatus,
  type EconDeviationsView,
  type EconSetup,
} from '@mvs/shared';
import { api, ApiError, economicsDeviationsQuery, economicsOverviewQuery } from '../../api';
import { date, money } from '../../ui/format';
import { analyse } from './analysis';
import { StatusMark } from './EconOverview';
import { STATUS_VAR, errorText, rub, signedPct } from './format';
import type { EconomicsSearch } from './search';

const statusColor: Record<EconDeviationStatus, string> = { OPEN: 'orange', IN_WORK: 'blue', RESOLVED: 'teal', DISMISSED: 'gray' };
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function EconDeviations({ data, search, update }: { data: EconSetup; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }) {
  const withRows = data.months.filter((m) => m.rows > 0).map((m) => m.month);
  const month = search.month ?? withRows[0] ?? econDefaultMonth();
  const query = useQuery(economicsDeviationsQuery(month));
  const overview = useQuery(economicsOverviewQuery(month));
  const [creating, setCreating] = useState<EconDeviationItem | null>(null);
  const [editing, setEditing] = useState<EconDeviationRecord | null>(null);
  const [all, setAll] = useState(false);
  const choices = [...new Set([...withRows, month])].sort().reverse();
  const budget = (id: number) => data.budgets.find((b) => b.id === id);
  const dirOf = (budgetId: number) => data.directions.find((d) => d.id === budget(budgetId)?.directionId);
  const inDir = (budgetId: number) => !search.dir || budget(budgetId)?.directionId === search.dir;
  const article = (id: number) => data.articles.find((a) => a.id === id)?.name ?? '—';
  const title = (budgetId: number) => `${dirOf(budgetId)?.shortName ?? ''} · ${budget(budgetId)?.title ?? '—'}`;

  if (query.error) return <Alert color="red">{query.error.message}</Alert>;
  if (!query.data) return <Skeleton height={420} />;
  const v = query.data;
  const pending = v.items.filter((x) => x.recordId == null && inDir(x.budgetId));
  const records = v.records.filter((r) => inDir(r.budgetId) && (all || econDeviationActive(r.status)));
  const active = v.records.filter((r) => inDir(r.budgetId) && econDeviationActive(r.status));
  const overdue = active.filter((r) => r.overdue).length;
  const overrun = v.items.filter((x) => x.kind === 'OVERRUN' && inDir(x.budgetId)).reduce((s, x) => s + Math.min(0, x.amount ?? 0), 0);
  const frozen = v.stock.filter((s) => inDir(s.budgetId) && s.status === 'critical').reduce((a, s) => a + Math.max(0, s.surplus ?? 0), 0);
  const mine = (r: EconDeviationRecord) => r.responsible?.id === v.userId;

  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end">
        <Select label="Направление" w={220} data={[{ value: '', label: 'Все направления' }, ...data.directions.map((d) => ({ value: String(d.id), label: d.shortName }))]} value={search.dir ? String(search.dir) : ''} onChange={(x) => update({ dir: x ? Number(x) : undefined })} allowDeselect={false} />
        <Select label="Нарастающим итогом по" w={220} data={choices.map((m) => ({ value: m, label: econMonthLabel(m) }))} value={month} onChange={(x) => x && update({ month: x })} allowDeselect={false} />
      </Group>
      <Text size="xs" c="dimmed">
        Отклонение — факт против плана на выполненный объём (лимит × готовность): перерасход больше 2% требует разбора. Закупка материалов больше потребности в 1,5 раза — тоже: деньги заморожены на складе.
        По каждому ПЭО указывает причину и решение — доказать доп. объёмы заказчику или решить, за счёт чего компенсировать; ответственный видит разбор в «Моих задачах».
      </Text>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
        <Paper withBorder p="md" radius="md" style={pending.length ? { borderLeft: '4px solid var(--status-warning)' } : undefined}>
          <Text size="sm" c="dimmed" fw={500}>Требуют разбора</Text>
          <Text fz={24} fw={650}>{pending.length}</Text>
          <Text size="xs" c="dimmed">отклонений без причины и решения</Text>
        </Paper>
        <Paper withBorder p="md" radius="md" style={overdue ? { borderLeft: '4px solid var(--status-critical)' } : undefined}>
          <Text size="sm" c="dimmed" fw={500}>Разборы в работе</Text>
          <Text fz={24} fw={650}>{active.length}</Text>
          {overdue ? <StatusMark status="critical" size="xs" label={`просрочено: ${overdue}`} /> : <Text size="xs" c="dimmed">сроки не нарушены</Text>}
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed" fw={500}>Перерасход по найденным</Text>
          <Text fz={24} fw={650} c={overrun < 0 ? 'var(--status-critical)' : undefined}>{money(Math.abs(overrun) || null)}</Text>
          <Text size="xs" c="dimmed">без НДС, нарастающим итогом</Text>
        </Paper>
        <Paper withBorder p="md" radius="md" style={frozen ? { borderLeft: '4px solid var(--status-critical)' } : undefined}>
          <Text size="sm" c="dimmed" fw={500}>Деньги на складе</Text>
          <Text fz={24} fw={650}>{money(frozen || null)}</Text>
          <Text size="xs" c="dimmed">закуплено сверх потребности (выше 1,5×)</Text>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="xs">Требуют разбора</Text>
        {!pending.length ? (
          <Text size="sm" c="dimmed">Все найденные отклонения разобраны.</Text>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table verticalSpacing={6} fz="sm" className="econ-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Центр затрат</Table.Th>
                  <Table.Th>Статья</Table.Th>
                  <Table.Th ta="right">План / потребность</Table.Th>
                  <Table.Th ta="right">Факт / закуплено</Table.Th>
                  <Table.Th ta="right">Отклонение</Table.Th>
                  <Table.Th>Состояние</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pending.map((x) => (
                  <Table.Tr key={`${x.budgetId}:${x.articleId}:${x.kind}`}>
                    <Table.Td><Text size="sm" lineClamp={1}>{title(x.budgetId)}</Text></Table.Td>
                    <Table.Td>{article(x.articleId)}{x.kind === 'STOCK' && <Text size="xs" c="dimmed">{ECON_DEVIATION_KIND_LABELS.STOCK}</Text>}</Table.Td>
                    <Table.Td ta="right">{rub(x.plan)}</Table.Td>
                    <Table.Td ta="right">{rub(x.fact)}</Table.Td>
                    <Table.Td ta="right" c={STATUS_VAR[x.status]} fw={600}>{x.kind === 'STOCK' ? `×${((x.fact ?? 0) / (x.plan || 1)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}` : `${rub(x.amount)} · ${signedPct(x.pct)}`}</Table.Td>
                    <Table.Td><StatusMark status={x.status} size="xs" label={x.kind === 'STOCK' ? 'Деньги на складе' : undefined} /></Table.Td>
                    <Table.Td ta="right">{v.canEdit && <Button size="xs" onClick={() => setCreating(x)}>Разобрать</Button>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <Conclusions data={data} view={v} overview={overview.data} dirFilter={search.dir} />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Разборы</Text>
          <SegmentedControl size="xs" value={all ? 'all' : 'active'} onChange={(x) => setAll(x === 'all')} data={[{ value: 'active', label: 'Активные' }, { value: 'all', label: 'Все' }]} />
        </Group>
        {!records.length ? (
          <Text size="sm" c="dimmed">{all ? 'Разборов пока нет.' : 'Активных разборов нет.'}</Text>
        ) : (
          <Table.ScrollContainer minWidth={1100}>
            <Table verticalSpacing={6} fz="sm" highlightOnHover style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Центр затрат, статья</Table.Th>
                  <Table.Th>Выявлено</Table.Th>
                  <Table.Th>Причина</Table.Th>
                  <Table.Th>Решение</Table.Th>
                  <Table.Th>Ответственный</Table.Th>
                  <Table.Th>Срок</Table.Th>
                  <Table.Th>Статус</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {records.map((r) => (
                  <Table.Tr key={r.id} style={{ cursor: v.canEdit || mine(r) ? 'pointer' : undefined }} onClick={() => (v.canEdit || mine(r)) && setEditing(r)}>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>{title(r.budgetId)}</Text>
                      <Text size="xs" c="dimmed">{article(r.articleId)}{r.kind === 'STOCK' ? ` · ${ECON_DEVIATION_KIND_LABELS.STOCK.toLowerCase()}` : ''}</Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Text size="sm">{econMonthLabel(r.month)}</Text>
                      <Text size="xs" c="dimmed">{r.kind === 'STOCK' ? `излишек ${rub(r.amount == null ? null : -r.amount)}` : `${rub(r.amount)} · ${signedPct(r.pct)}`}</Text>
                    </Table.Td>
                    <Table.Td><Text size="sm">{econCauseLabel(r.cause)}</Text>{r.causeText && <Text size="xs" c="dimmed" lineClamp={2}>{r.causeText}</Text>}</Table.Td>
                    <Table.Td><Text size="sm">{econDecisionLabel(r.decision)}</Text>{r.decisionText && <Text size="xs" c="dimmed" lineClamp={2}>{r.decisionText}</Text>}{r.result && <Text size="xs" c="dimmed" lineClamp={2}>Итог: {r.result}</Text>}</Table.Td>
                    <Table.Td>{r.responsible?.fullName ?? '—'}{mine(r) && <Badge size="xs" ml={6} variant="light">вы</Badge>}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {r.overdue ? (
                        <Group gap={4} wrap="nowrap" c="var(--status-critical)"><IconClockExclamation size={15} aria-hidden /><Text size="sm" c="var(--status-critical)" fw={600}>{date(r.dueDate)}</Text></Group>
                      ) : date(r.dueDate)}
                    </Table.Td>
                    <Table.Td><Badge variant="light" color={statusColor[r.status]}>{ECON_DEVIATION_STATUS_LABELS[r.status]}</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text fw={600}>Материалы: закуплено и потребность</Text>
        <Text size="xs" c="dimmed" mb="xs">Нарастающим итогом, без НДС. Потребность — лимит материалов × готовность. Закупка больше потребности в 1,5 раза — следующие закупки только с обоснованием, почему материалы лежат на складе.</Text>
        {!v.stock.filter((s) => inDir(s.budgetId)).length ? (
          <Text size="sm" c="dimmed">Закупки не внесены. Их вносит ПЭО в «Факте за месяц» — колонка «Закуплено материалов».</Text>
        ) : (
          <Table.ScrollContainer minWidth={820}>
            <Table verticalSpacing={5} fz="sm" className="econ-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Центр затрат</Table.Th>
                  <Table.Th ta="right">Закуплено</Table.Th>
                  <Table.Th ta="right">Потребность</Table.Th>
                  <Table.Th ta="right">Списано</Table.Th>
                  <Table.Th ta="right">Излишек</Table.Th>
                  <Table.Th>Закупка к потребности</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {v.stock.filter((s) => inDir(s.budgetId)).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).map((s) => (
                  <Table.Tr key={s.budgetId}>
                    <Table.Td><Text size="sm" lineClamp={1}>{title(s.budgetId)}</Text></Table.Td>
                    <Table.Td ta="right">{rub(s.purchased)}</Table.Td>
                    <Table.Td ta="right">{rub(s.need)}</Table.Td>
                    <Table.Td ta="right">{rub(s.consumed)}</Table.Td>
                    <Table.Td ta="right" c={s.surplus != null && s.surplus > 0 && s.status !== 'good' ? STATUS_VAR[s.status] : undefined}>{rub(s.surplus)}</Table.Td>
                    <Table.Td><StatusMark status={s.status} size="xs" label={s.ratio == null ? 'нет потребности' : `×${s.ratio.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      {creating && <CreateDialog item={creating} month={month} view={v} title={title(creating.budgetId)} articleName={article(creating.articleId)} directionId={budget(creating.budgetId)?.directionId ?? 0} onClose={() => setCreating(null)} />}
      {editing && <EditDialog record={editing} view={v} title={title(editing.budgetId)} articleName={article(editing.articleId)} directionId={budget(editing.budgetId)?.directionId ?? 0} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

/** Часть 4 таблицы ПЭО: по направлениям и статьям — экономия или перерасход (сумма) и комментарии из разборов. */
function Conclusions({ data, view, overview, dirFilter }: { data: EconSetup; view: EconDeviationsView; overview: import('@mvs/shared').EconOverview | undefined; dirFilter?: number }) {
  const direct = data.articles.filter((a) => !econIsCompanyKind(a.kind) && !a.isArchived);
  const dirs = data.directions.filter((d) => (!dirFilter || d.id === dirFilter) && data.budgets.some((b) => b.directionId === d.id && !b.isArchived));
  const cells = useMemo(() => {
    const out = new Map<string, number>();
    if (!overview) return out;
    for (const b of data.budgets.filter((x) => !x.isArchived)) {
      const a = analyse(b, data.articles, overview);
      for (const [articleId, m] of a.byArticle) if (m.dev != null && m.fact != null) out.set(`${b.directionId}:${articleId}`, (out.get(`${b.directionId}:${articleId}`) ?? 0) + m.dev);
    }
    return out;
  }, [data, overview]);
  const comments = (directionId: number, articleId: number, kind: 'OVERRUN' | 'STOCK') =>
    view.records.filter((r) => r.articleId === articleId && r.kind === kind && data.budgets.find((b) => b.id === r.budgetId)?.directionId === directionId && (econDeviationActive(r.status) || r.month === view.month));
  const stockOf = (directionId: number) => view.stock.filter((s) => data.budgets.find((b) => b.id === s.budgetId)?.directionId === directionId);
  if (!dirs.length) return null;
  const Comment = ({ list }: { list: EconDeviationRecord[] }) =>
    list.length ? (
      <Stack gap={2}>
        {list.slice(0, 2).map((r) => (
          <Text key={r.id} size="xs" lineClamp={3}>
            {econCauseLabel(r.cause)} → {econDecisionLabel(r.decision)}{r.responsible ? ` (${r.responsible.fullName}, до ${date(r.dueDate)})` : ''}{r.status === 'RESOLVED' ? ' — решено' : ''}
          </Text>
        ))}
        {list.length > 2 && <Text size="xs" c="dimmed">ещё {list.length - 2}</Text>}
      </Stack>
    ) : <Text size="xs" c="dimmed">—</Text>;
  return (
    <Paper withBorder p="md" radius="md">
      <Text fw={600}>Выводы по направлениям</Text>
      <Text size="xs" c="dimmed" mb="xs">Как часть 4 таблицы ПЭО: показатель текстовый (экономия или перерасход), цифровой (+ экономия, − перерасход, без НДС) и комментарий из разборов.</Text>
      {!overview ? <Skeleton height={160} /> : (
        <Table.ScrollContainer minWidth={240 + dirs.length * 420}>
          <Table verticalSpacing={5} fz="sm" withColumnBorders style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th rowSpan={2} miw={200}>Статья</Table.Th>
                {dirs.map((d) => <Table.Th key={d.id} colSpan={3} ta="center">{d.shortName}</Table.Th>)}
              </Table.Tr>
              <Table.Tr>
                {dirs.map((d) => [<Table.Th key={`${d.id}t`}>Показатель</Table.Th>, <Table.Th key={`${d.id}n`} ta="right">Сумма</Table.Th>, <Table.Th key={`${d.id}c`} miw={180}>Комментарий</Table.Th>])}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {direct.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>{a.name}</Table.Td>
                  {dirs.map((d) => {
                    const dev = cells.get(`${d.id}:${a.id}`);
                    const over = dev != null && dev < 0;
                    return [
                      <Table.Td key={`${d.id}t`} c={dev == null ? 'dimmed' : over ? 'var(--status-critical)' : 'var(--status-good)'}>{dev == null ? '—' : over ? 'Перерасход' : 'Экономия'}</Table.Td>,
                      <Table.Td key={`${d.id}n`} ta="right" style={{ whiteSpace: 'nowrap' }}>{dev == null ? '—' : `${dev > 0 ? '+' : dev < 0 ? '−' : ''}${rub(Math.abs(dev))}`}</Table.Td>,
                      <Table.Td key={`${d.id}c`}><Comment list={comments(d.id, a.id, 'OVERRUN')} /></Table.Td>,
                    ];
                  })}
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td>Материалы: закупка к потребности</Table.Td>
                {dirs.map((d) => {
                  const s = stockOf(d.id);
                  const purchased = s.reduce((x, r) => x + r.purchased, 0);
                  const need = s.reduce((x, r) => x + (r.need ?? 0), 0);
                  const ratio = need ? purchased / need : null;
                  const worst = s.some((r) => r.status === 'critical') ? 'critical' : s.some((r) => r.status === 'warning') ? 'warning' : s.length ? 'good' : 'none';
                  const materialsId = data.articles.find((x) => x.code === 'materials')?.id ?? 0;
                  return [
                    <Table.Td key={`${d.id}t`} c={STATUS_VAR[worst]}>{!s.length ? '—' : worst === 'good' ? 'В норме' : 'Сверх потребности'}</Table.Td>,
                    <Table.Td key={`${d.id}n`} ta="right">{ratio == null ? '—' : `×${ratio.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`}</Table.Td>,
                    <Table.Td key={`${d.id}c`}><Comment list={comments(d.id, materialsId, 'STOCK')} /></Table.Td>,
                  ];
                })}
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Paper>
  );
}

function Numbers({ plan, fact, amount, pct, stock }: { plan: number | null; fact: number | null; amount: number | null; pct: number | null; stock: boolean }) {
  return (
    <SimpleGrid cols={3} spacing="xs">
      <div><Text size="xs" c="dimmed">{stock ? 'Потребность' : 'План на объём'}</Text><Text fw={600}>{rub(plan)}</Text></div>
      <div><Text size="xs" c="dimmed">{stock ? 'Закуплено' : 'Факт'}</Text><Text fw={600}>{rub(fact)}</Text></div>
      <div><Text size="xs" c="dimmed">{stock ? 'Излишек' : 'Отклонение'}</Text><Text fw={600} c="var(--status-critical)">{stock ? rub(amount == null ? null : -amount) : `${rub(amount)} · ${signedPct(pct)}`}</Text></div>
    </SimpleGrid>
  );
}

function CreateDialog({ item, month, view, title, articleName, directionId, onClose }: { item: EconDeviationItem; month: string; view: EconDeviationsView; title: string; articleName: string; directionId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const mobile = useMediaQuery('(max-width: 48em)');
  const [form, setForm] = useState({ cause: item.kind === 'STOCK' ? 'stock' : '', causeText: '', decision: item.kind === 'STOCK' ? 'stop_purchase' : '', decisionText: '', responsibleId: '', dueDate: plusDays(14) });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  async function save() {
    const body = { budgetId: item.budgetId, articleId: item.articleId, kind: item.kind, month, cause: form.cause || undefined, causeText: form.causeText || null, decision: form.decision || undefined, decisionText: form.decisionText || null, responsibleId: Number(form.responsibleId) || undefined, dueDate: form.dueDate };
    const parsed = econDeviationCreateSchema.safeParse(body);
    if (!parsed.success) return setFields(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    setBusy(true);
    setError('');
    try {
      await api('/economics/deviations', { method: 'POST', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      await qc.invalidateQueries({ queryKey: ['me', 'tasks'] });
      notifications.show({ color: 'green', message: 'Разбор заведён, ответственный увидит его в «Моих задачах»' });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title="Разбор отклонения" size="lg" fullScreen={mobile}>
      <Stack gap="sm">
        <div><Text fw={600}>{title}</Text><Text size="sm" c="dimmed">{articleName}{item.kind === 'STOCK' ? ` · ${ECON_DEVIATION_KIND_LABELS.STOCK.toLowerCase()}` : ''} · на {econMonthLabel(month).toLowerCase()}</Text></div>
        <Numbers plan={item.plan} fact={item.fact} amount={item.amount} pct={item.pct} stock={item.kind === 'STOCK'} />
        <Select label="Причина" data={ECON_CAUSES.map((c) => ({ value: c.code, label: c.label }))} value={form.cause || null} onChange={(x) => set({ cause: x ?? '' })} error={fields.cause} comboboxProps={{ zIndex: 1000 }} required />
        <Textarea label="Пояснение к причине" placeholder={form.cause === 'volume' ? 'Какие объёмы добавились и чем подтверждаются' : ''} value={form.causeText} onChange={(e) => set({ causeText: e.currentTarget.value })} error={fields.causeText} autosize minRows={2} />
        <Select label="Решение" data={ECON_DECISIONS.map((c) => ({ value: c.code, label: c.label }))} value={form.decision || null} onChange={(x) => set({ decision: x ?? '' })} error={fields.decision} comboboxProps={{ zIndex: 1000 }} required />
        <Textarea label="Что сделать" placeholder={form.decision === 'compensate' ? 'За счёт каких статей и объектов' : ''} value={form.decisionText} onChange={(e) => set({ decisionText: e.currentTarget.value })} error={fields.decisionText} autosize minRows={2} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Ответственный" data={(view.candidates[String(directionId)] ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))} value={form.responsibleId || null} onChange={(x) => set({ responsibleId: x ?? '' })} error={fields.responsibleId} searchable comboboxProps={{ zIndex: 1000 }} required />
          <TextInput type="date" label="Срок" value={form.dueDate} onChange={(e) => set({ dueDate: e.currentTarget.value })} error={fields.dueDate} required />
        </SimpleGrid>
        {error && <Alert color="red" icon={<IconAlertOctagon size={16} />}>{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={save}>Завести разбор</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditDialog({ record, view, title, articleName, directionId, onClose }: { record: EconDeviationRecord; view: EconDeviationsView; title: string; articleName: string; directionId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const mobile = useMediaQuery('(max-width: 48em)');
  const full = view.canEdit;
  const [form, setForm] = useState({ status: record.status, result: record.result ?? '', cause: record.cause, causeText: record.causeText ?? '', decision: record.decision, decisionText: record.decisionText ?? '', responsibleId: String(record.responsible?.id ?? ''), dueDate: record.dueDate ?? '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const statuses = (full ? (['OPEN', 'IN_WORK', 'RESOLVED', 'DISMISSED'] as const) : (['OPEN', 'IN_WORK', 'RESOLVED'] as const)).map((s) => ({ value: s, label: ECON_DEVIATION_STATUS_LABELS[s] }));
  async function save() {
    const body = full
      ? { version: record.version, status: form.status, result: form.result || null, cause: form.cause, causeText: form.causeText || null, decision: form.decision, decisionText: form.decisionText || null, responsibleId: Number(form.responsibleId) || undefined, dueDate: form.dueDate || undefined }
      : { version: record.version, status: form.status, result: form.result || null };
    const parsed = econDeviationUpdateSchema.safeParse(body);
    if (!parsed.success) return setFields(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    setBusy(true);
    setError('');
    try {
      await api(`/economics/deviations/${record.id}`, { method: 'PUT', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      await qc.invalidateQueries({ queryKey: ['me', 'tasks'] });
      notifications.show({ color: 'green', message: 'Разбор сохранён' });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title="Разбор отклонения" size="lg" fullScreen={mobile}>
      <Stack gap="sm">
        <div>
          <Text fw={600}>{title}</Text>
          <Text size="sm" c="dimmed">{articleName} · выявлено на {econMonthLabel(record.month).toLowerCase()}{record.createdBy ? ` · завёл ${record.createdBy}` : ''}</Text>
        </div>
        <Numbers plan={record.plan} fact={record.fact} amount={record.amount} pct={record.pct} stock={record.kind === 'STOCK'} />
        {full ? (
          <>
            <Select label="Причина" data={ECON_CAUSES.map((c) => ({ value: c.code, label: c.label }))} value={form.cause} onChange={(x) => x && set({ cause: x })} comboboxProps={{ zIndex: 1000 }} allowDeselect={false} />
            <Textarea label="Пояснение к причине" value={form.causeText} onChange={(e) => set({ causeText: e.currentTarget.value })} error={fields.causeText} autosize minRows={2} />
            <Select label="Решение" data={ECON_DECISIONS.map((c) => ({ value: c.code, label: c.label }))} value={form.decision} onChange={(x) => x && set({ decision: x })} comboboxProps={{ zIndex: 1000 }} allowDeselect={false} />
            <Textarea label="Что сделать" value={form.decisionText} onChange={(e) => set({ decisionText: e.currentTarget.value })} error={fields.decisionText} autosize minRows={2} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select label="Ответственный" data={(view.candidates[String(directionId)] ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))} value={form.responsibleId || null} onChange={(x) => x && set({ responsibleId: x })} error={fields.responsibleId} searchable comboboxProps={{ zIndex: 1000 }} allowDeselect={false} />
              <TextInput type="date" label="Срок" value={form.dueDate} onChange={(e) => set({ dueDate: e.currentTarget.value })} error={fields.dueDate} />
            </SimpleGrid>
          </>
        ) : (
          <Paper withBorder p="sm" radius="md">
            <Text size="sm"><b>Причина:</b> {econCauseLabel(record.cause)}{record.causeText ? ` — ${record.causeText}` : ''}</Text>
            <Text size="sm"><b>Решение:</b> {econDecisionLabel(record.decision)}{record.decisionText ? ` — ${record.decisionText}` : ''}</Text>
            <Text size="sm"><b>Срок:</b> {date(record.dueDate)}{record.overdue ? ' (просрочен)' : ''}</Text>
          </Paper>
        )}
        <Select label="Статус" data={statuses} value={form.status} onChange={(x) => x && set({ status: x as EconDeviationStatus })} comboboxProps={{ zIndex: 1000 }} allowDeselect={false} />
        <Tooltip label="Обязательно для «Решено» и «Снято»" disabled={form.status !== 'RESOLVED' && form.status !== 'DISMISSED'}>
          <Textarea label="Итог: что сделано" value={form.result} onChange={(e) => set({ result: e.currentTarget.value })} error={fields.result} autosize minRows={2} />
        </Tooltip>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={save}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
