import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  Affix,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconDeviceFloppy, IconLock, IconLockOpen, IconPlus, IconSearch } from '@tabler/icons-react';
import type { EntryReportValue, EntrySaveInput, EntrySheet, EntryValue, PeriodItem } from '@mvs/shared';
import { api, ApiError, directionQueries } from '../../api';
import { date, weekLabel } from '../../ui/format';
import { DelayReason } from './DelayReasonField';

type Site = EntrySheet['sites'][number];
type Item = Site['items'][number];
type Draft = {
  items: Record<number, Partial<EntryValue>>;
  reports: Record<number, Partial<EntryReportValue>>;
};
const EMPTY: Draft = { items: {}, reports: {} };

const STATUS_VIEW = {
  OPEN: { label: 'открыта для ввода', color: 'blue' },
  CLOSED: { label: 'закрыта куратором', color: 'green' },
  LOCKED: { label: 'заблокирована', color: 'gray' },
} as const;

/** Ввод данных за отчётную точку: факт по позициям и показатели объектов. Сохраняется одной кнопкой. */
export function EntryTab({ code, periodKind, program = '', onDirty }: { code: string; periodKind: string; program?: string; onDirty?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const { data: periods } = useQuery(directionQueries.periods(code));
  const own = (periods ?? []).filter((p) => p.program === program);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const current = periodId ?? own.find((p) => p.status === 'OPEN')?.id ?? own[0]?.id ?? null;
  const {
    data: sheet,
    error,
    isFetching,
  } = useQuery({
    ...directionQueries.entry(code, current ?? 0),
    enabled: current != null,
  });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [notUpdated, setNotUpdated] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const narrow = useMediaQuery('(max-width: 48em)');
  // раскрытые объекты; содержимое свёрнутых не рисуется — на телефоне сотни полей тормозят
  const [opened, setOpened] = useState<string[] | null>(null);

  const dirtyCount = Object.keys(draft.items).length + Object.keys(draft.reports).length;
  useEffect(() => { onDirty?.(dirtyCount > 0); }, [dirtyCount, onDirty]);
  // не потерять несохранённое при закрытии вкладки браузера
  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirtyCount]);
  useEffect(() => setDraft(EMPTY), [current]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['dir', code] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
      qc.invalidateQueries({ queryKey: ['map'] }),
      qc.invalidateQueries({ queryKey: ['me', 'tasks'] }),
    ]);

  const save = useMutation({
    mutationFn: (body: EntrySaveInput) =>
      api<{ savedItems: number; savedReports: number; unchanged: number }>(`/directions/${code}/entry/${current}`, { method: 'PUT', body }),
    onSuccess: async (r) => {
      setDraft(EMPTY);
      setConflicts([]);
      await refresh();
      notifications.show({
        color: 'green',
        message: `Сохранено: позиций ${r.savedItems}, объектов ${r.savedReports}${r.unchanged ? `, без изменений ${r.unchanged}` : ''}`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflicts(e.conflicts);
      notifications.show({
        color: 'red',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    },
  });

  const sites = useMemo(() => {
    if (!sheet) return [];
    const ql = q.trim().toLowerCase();
    return sheet.sites
      .filter((s) => !sheet.permissions.canEdit || scope === 'all' || s.canEdit)
      .filter((s) => !ql || s.name.toLowerCase().includes(ql) || s.items.some((i) => i.name.toLowerCase().includes(ql)))
      .filter((s) => !notUpdated || !s.updated);
  }, [sheet, scope, q, notUpdated]);

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (periods && !own.length) return <Alert color="gray">Отчётных периодов пока нет.</Alert>;
  if (!periods || !sheet) return <Skeleton h={400} />;
  const shownOpen = opened ?? sites.slice(0, narrow ? 1 : 3).map((s) => String(s.id));

  const editable = sheet.sites.filter((s) => s.canEdit);
  const updated = editable.filter((s) => s.updated).length;

  /** Полный набор значений строки (действующие + правки) — сервер сохраняет запись этой точки целиком. */
  const itemBody = (i: Item) => ({
    workItemId: i.id,
    ...i.value,
    ...draft.items[i.id],
    version: i.version ?? undefined,
  });
  const reportBody = (s: Site) => ({
    siteId: s.id,
    ...s.report.value,
    ...draft.reports[s.id],
    version: s.report.version ?? undefined,
  });

  const submit = () => {
    // REPORT — полный снимок объекта. Сохраняем показанные перенесённые значения его ещё не внесённых строк,
    // иначе правка только людей/техники создаёт отчёт без объёмов. Другие объекты не подтверждаем автоматически.
    const touched = (s: Site) => !!draft.reports[s.id] || s.items.some(i => !!draft.items[i.id]);
    save.mutate({
      items: sheet.sites.flatMap(s => s.items.filter(i => draft.items[i.id] || (periodKind === 'REPORT' && touched(s) && i.version == null))).map(itemBody),
      reports: sheet.sites.filter(s => draft.reports[s.id] || (periodKind === 'REPORT' && touched(s) && s.report.version == null)).map(reportBody),
    });
  };
  /** «Без изменений»: перенести действующие значения в эту точку — объект отмечается как обновлённый. */
  const confirmSite = (s: Site) =>
    save.mutate({
      items: s.items.filter((i) => i.version == null || draft.items[i.id]).map(itemBody),
      reports: sheet.fields.workers && (s.report.version == null || draft.reports[s.id]) ? [reportBody(s)] : [],
    });

  return (
    <Stack>
      <PeriodBar code={code} sheet={sheet} periods={own} periodKind={periodKind} onSelect={setPeriodId} dirty={dirtyCount > 0} onChanged={refresh} />

      {sheet.permissions.reason && <Alert color="orange">{sheet.permissions.reason}</Alert>}
      {conflicts.length > 0 && (
        <Alert color="red" title="Данные изменил другой пользователь" withCloseButton onClose={() => setConflicts([])}>
          {conflicts.slice(0, 8).join('; ')}
          {conflicts.length > 8 ? ` и ещё ${conflicts.length - 8}` : ''}. Нажмите «Обновить лист»: увидите их значения, а ваши несохранённые правки останутся в
          форме — проверьте и сохраните снова.
          <Button size="xs" mt="xs" variant="light" onClick={() => qc.invalidateQueries({ queryKey: ['dir', code, 'entry'] })}>
            Обновить лист
          </Button>
        </Alert>
      )}

      {editable.length > 0 && (
        <Card withBorder padding="md">
          <Group justify="space-between" mb={6}>
            <Text size="sm">
              Внесено в эту точку: <b>{updated}</b> из {editable.length} ваших объектов
            </Text>
            <Text size="xs" c="dimmed">
              объект считается внесённым, когда по нему сохранено хотя бы одно значение или нажато «Без изменений»
            </Text>
          </Group>
          <Progress value={(updated / editable.length) * 100} color={updated === editable.length ? 'green' : 'blue'} />
        </Card>
      )}

      <Group gap="sm">
        {editable.length > 0 && editable.length < sheet.sites.length && (
          <SegmentedControl
            value={scope}
            onChange={(v) => setScope(v as 'mine' | 'all')}
            data={[
              { value: 'mine', label: `Мои объекты · ${editable.length}` },
              { value: 'all', label: `Все · ${sheet.sites.length}` },
            ]}
          />
        )}
        <TextInput aria-label="Объект или работа" placeholder="Объект или работа" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={240} />
        <Switch label="Только не внесённые" checked={notUpdated} onChange={(e) => setNotUpdated(e.currentTarget.checked)} />
        {isFetching && (
          <Text size="xs" c="dimmed">
            обновление…
          </Text>
        )}
      </Group>

      <Accordion multiple variant="separated" value={shownOpen} onChange={setOpened} mb={dirtyCount && narrow ? 70 : undefined}>
        {sites.map((s) => (
          <SiteEntry
            key={s.id}
            site={s}
            sheet={sheet}
            draft={draft}
            setDraft={setDraft}
            open={shownOpen.includes(String(s.id))}
            onConfirm={() => confirmSite(s)}
            saving={save.isPending}
          />
        ))}
      </Accordion>
      {!sites.length && (
        <Text c="dimmed" ta="center">
          Нет объектов по фильтру
        </Text>
      )}

      {dirtyCount > 0 && (
        <Affix position={narrow ? { bottom: 0, left: 0, right: 0 } : { bottom: 20, right: 20 }}>
          <Paper shadow="lg" p="sm" withBorder radius={narrow ? 0 : undefined}>
            {narrow ? (
              // на телефоне — во всю ширину, число изменений на кнопке
              <Group wrap="nowrap" gap="xs">
                <Button variant="default" size="md" onClick={() => setDraft(EMPTY)}>
                  Отмена
                </Button>
                <Button size="md" style={{ flex: 1 }} leftSection={<IconDeviceFloppy size={18} />} loading={save.isPending} onClick={submit}>
                  Сохранить · {dirtyCount}
                </Button>
              </Group>
            ) : (
              <Group wrap="nowrap">
                <Text size="sm">
                  Изменено строк: <b>{dirtyCount}</b>
                </Text>
                <Button variant="default" size="sm" onClick={() => setDraft(EMPTY)}>
                  Отменить
                </Button>
                <Button size="sm" leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} onClick={submit}>
                  Сохранить
                </Button>
              </Group>
            )}
          </Paper>
        </Affix>
      )}
    </Stack>
  );
}

/** Выбор отчётной точки, её статус и действия куратора. */
function PeriodBar({
  code,
  sheet,
  periods,
  periodKind,
  onSelect,
  dirty,
  onChanged,
}: {
  code: string;
  sheet: EntrySheet;
  periods: PeriodItem[];
  periodKind: string;
  onSelect: (id: number) => void;
  dirty: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [action, setAction] = useState<null | 'CLOSED' | 'OPEN' | 'LOCKED' | 'new'>(null);
  const [comment, setComment] = useState('');
  const [newDate, setNewDate] = useState('');
  const perm = sheet.permissions;
  const label = (p: PeriodItem) => (periodKind === 'WEEK' ? weekLabel(p.date) : date(p.date));
  const unit = periodKind === 'WEEK' ? 'неделю' : periodKind === 'REPORT' ? 'отчёт' : 'день';

  const run = useMutation({
    mutationFn: async () => {
      if (action === 'new')
        return api<{ id: number }>(`/directions/${code}/periods`, {
          method: 'POST',
          body: { date: newDate, program: sheet.period.program },
        });
      return api(`/directions/${code}/periods/${sheet.period.id}/status`, {
        method: 'POST',
        body: { status: action, comment: comment || undefined },
      });
    },
    onSuccess: async (r) => {
      setAction(null);
      setComment('');
      await onChanged();
      if (r && typeof r === 'object' && 'id' in r && action === 'new') onSelect((r as { id: number }).id);
      notifications.show({ color: 'green', message: 'Готово' });
    },
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: e instanceof ApiError ? e.message : 'Ошибка',
      }),
  });

  const nextDate = () => {
    const last = periods[0]?.date;
    const d = last ? new Date(Date.parse(`${last}T00:00:00Z`) + (periodKind === 'WEEK' ? 7 : 1) * 86_400_000) : new Date();
    return d.toISOString().slice(0, 10);
  };

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm">
          <Select
            w={260}
            aria-label="Отчётная точка"
            value={String(sheet.period.id)}
            onChange={(v) => {
              if (v && (!dirty || confirm('Есть несохранённые изменения. Перейти без сохранения?'))) onSelect(Number(v));
            }}
            data={periods.map((p) => ({
              value: String(p.id),
              label: `${label(p)}${p.status === 'OPEN' ? '' : p.status === 'CLOSED' ? ' · закрыта' : ' · заблок.'}`,
            }))}
            allowDeselect={false}
          />
          <Badge variant="light" color={STATUS_VIEW[sheet.period.status].color} size="lg">
            {STATUS_VIEW[sheet.period.status].label}
          </Badge>
        </Group>
        <Group gap="xs">
          {perm.canClose && (
            <Button size="sm" leftSection={<IconCheck size={16} />} onClick={() => setAction('CLOSED')}>
              Проверено, закрыть {unit}
            </Button>
          )}
          {perm.canReopen && (
            <Button size="sm" variant="default" leftSection={<IconLockOpen size={16} />} onClick={() => setAction('OPEN')}>
              Вернуть в работу
            </Button>
          )}
          {perm.canLock && (
            <Button size="sm" variant="default" leftSection={<IconLock size={16} />} onClick={() => setAction('LOCKED')}>
              Заблокировать
            </Button>
          )}
          {perm.canOpenNew && (
            <Button
              size="sm"
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setNewDate(nextDate());
                setAction('new');
              }}
            >
              {periodKind === 'WEEK' ? 'Открыть новую неделю' : periodKind === 'REPORT' ? 'Открыть новый отчёт' : 'Открыть новый день'}
            </Button>
          )}
        </Group>
      </Group>

      <Modal
        className="direction-page"
        opened={action != null}
        onClose={() => setAction(null)}
        title={
          action === 'new'
            ? `Новая ${periodKind === 'WEEK' ? 'отчётная неделя' : 'отчётная дата'}`
            : action === 'CLOSED'
              ? 'Закрыть отчётную точку'
              : action === 'OPEN'
                ? 'Вернуть в работу'
                : 'Заблокировать'
        }
      >
        <Stack>
          {action === 'new' ? (
            <>
              <TextInput type="date" label="Дата" value={newDate} onChange={(e) => setNewDate(e.currentTarget.value)} />
              {periodKind === 'WEEK' && (
                <Text size="xs" c="dimmed">
                  Неделя начинается с понедельника — любая дата будет приведена к понедельнику своей недели. Значения перенесутся с прошлой недели,
                  ответственные их обновят.
                </Text>
              )}
            </>
          ) : (
            <>
              <Text size="sm">
                {action === 'CLOSED' && 'Данные будут отмечены как проверенные куратором. Ответственные за ввод больше не смогут их менять — только куратор.'}
                {action === 'OPEN' && 'Ответственные за ввод снова смогут вносить и менять данные этой точки.'}
                {action === 'LOCKED' && 'Править данные сможет только администратор. Используйте для окончательно сданных отчётов.'}
              </Text>
              <Textarea label="Комментарий (попадёт в журнал)" value={comment} onChange={(e) => setComment(e.currentTarget.value)} maxLength={500} />
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAction(null)}>
              Отмена
            </Button>
            <Button loading={run.isPending} onClick={() => run.mutate()} disabled={action === 'new' && !newDate}>
              {action === 'new' ? 'Открыть' : 'Подтвердить'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

const dirtyStyle = (on: boolean) => (on ? { input: { background: 'var(--dirty)' } } : undefined);

/** Объект в листе ввода: показатели объекта и таблица позиций. */
function SiteEntry({
  site,
  sheet,
  draft,
  setDraft,
  onConfirm,
  saving,
  open,
}: {
  site: Site;
  sheet: EntrySheet;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  onConfirm: () => void;
  saving: boolean;
  open: boolean;
}) {
  const f = sheet.fields;
  const ro = !site.canEdit;
  const setItem = (id: number, base: EntryValue, patch: Partial<EntryValue>) =>
    setDraft((d) => {
      const next = { ...d.items[id], ...patch };
      // правка вернула исходное значение — строка больше не изменена
      const clean = Object.entries(next).every(([k, v]) => (base as unknown as Record<string, unknown>)[k] === v);
      const items = { ...d.items };
      if (clean) delete items[id];
      else items[id] = next;
      return { ...d, items };
    });
  const setReport = (patch: Partial<EntryReportValue>) =>
    setDraft((d) => {
      const next = { ...d.reports[site.id], ...patch };
      const clean = Object.entries(next).every(([k, v]) => (site.report.value as unknown as Record<string, unknown>)[k] === v);
      const reports = { ...d.reports };
      if (clean) delete reports[site.id];
      else reports[site.id] = next;
      return { ...d, reports };
    });
  const rv = { ...site.report.value, ...draft.reports[site.id] };
  const rDirty = (k: keyof EntryReportValue) => draft.reports[site.id]?.[k] !== undefined;
  const numOrNull = (v: string | number) => (v === '' || v == null ? null : Number(v));
  const changed = site.items.some((i) => draft.items[i.id]) || !!draft.reports[site.id];
  const statusData = sheet.statuses.map((s) => ({
    value: s.code,
    label: s.name,
  }));
  const narrow = useMediaQuery('(max-width: 48em)');

  return (
    <Accordion.Item value={String(site.id)}>
      <Accordion.Control>
        <Group justify="space-between" wrap="nowrap" pr="sm">
          <div style={{ minWidth: 0 }}>
            <Text fw={600} truncate>
              {site.name}
            </Text>
            <Text size="xs" c="dimmed">
              {[site.section, `${site.items.length} поз.`].filter(Boolean).join(' · ')}
            </Text>
          </div>
          <Group gap={6} wrap="nowrap">
            {changed && (
              <Badge color="yellow" variant="light">
                не сохранено
              </Badge>
            )}
            {site.updated ? (
              <Badge color="green" variant="light">
                внесено
              </Badge>
            ) : (
              <Badge color="gray" variant="light">
                не обновлялось
              </Badge>
            )}
            {ro && (
              <Badge color="gray" variant="outline">
                только просмотр
              </Badge>
            )}
          </Group>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        {open && (
          <Stack gap="sm">
            {f.reportStatus && <Group align="flex-end">
              <TextInput label="Отчётный статус объекта" value={rv.statusText ?? ''} disabled={ro} maxLength={200} styles={dirtyStyle(rDirty('statusText'))} onChange={e => setReport({ statusText: e.currentTarget.value || null })} />
              {f.reportRemarks && <NumberInput label="Замечаний по отчёту" value={rv.remarksCount ?? ''} disabled={ro} min={0} allowDecimal={false} styles={dirtyStyle(rDirty('remarksCount'))} onChange={v => setReport({ remarksCount: numOrNull(v) })} />}
            </Group>}
            {(f.workers || f.reportKs || f.reportPaid) && (
              <Group gap="sm" align="flex-end">
                {f.workers && (
                  <NumberInput
                    label="Людей"
                    w={110}
                    min={0}
                    allowDecimal={false}
                    disabled={ro}
                    value={rv.workers ?? ''}
                    styles={dirtyStyle(rDirty('workers'))}
                    onChange={(v) => setReport({ workers: numOrNull(v) })}
                  />
                )}
                {f.workers && (
                  <NumberInput
                    label="Техники"
                    w={110}
                    min={0}
                    allowDecimal={false}
                    disabled={ro}
                    value={rv.machines ?? ''}
                    styles={dirtyStyle(rDirty('machines'))}
                    onChange={(v) => setReport({ machines: numOrNull(v) })}
                  />
                )}
                {f.blocked && (
                  <NumberInput
                    label="Людей не допущено"
                    w={150}
                    min={0}
                    allowDecimal={false}
                    disabled={ro}
                    value={rv.workersBlocked ?? ''}
                    styles={dirtyStyle(rDirty('workersBlocked'))}
                    onChange={(v) => setReport({ workersBlocked: numOrNull(v) })}
                  />
                )}
                {f.reportKs && (
                  <NumberInput
                    label="Закрыто по КС, ₽"
                    w={190}
                    min={0}
                    thousandSeparator=" "
                    decimalSeparator=","
                    disabled={ro}
                    value={rv.ks ?? ''}
                    styles={dirtyStyle(rDirty('ks'))}
                    onChange={(v) => setReport({ ks: numOrNull(v) })}
                  />
                )}
                {f.reportPaid && (
                  <NumberInput
                    label="Оплачено, ₽"
                    w={190}
                    min={0}
                    thousandSeparator=" "
                    decimalSeparator=","
                    disabled={ro}
                    value={rv.paid ?? ''}
                    styles={dirtyStyle(rDirty('paid'))}
                    onChange={(v) => setReport({ paid: numOrNull(v) })}
                  />
                )}
                {site.report.from && site.report.version == null && (
                  <Text size="xs" c="dimmed" pb={8}>
                    значения с {date(site.report.from)}
                  </Text>
                )}
              </Group>
            )}

            {narrow ? (
              <Stack gap="xs">
                {site.items.map((i) => (
                  <ItemCard
                    key={i.id}
                    code={sheet.direction.code}
                    periodId={sheet.period.id}
                    i={i}
                    v={{ ...i.value, ...draft.items[i.id] }}
                    dirty={(k) => draft.items[i.id]?.[k] !== undefined}
                    f={f}
                    ro={ro}
                    statusData={statusData}
                    set={(p) => setItem(i.id, i.value, p)}
                  />
                ))}
              </Stack>
            ) : (
              <Table.ScrollContainer minWidth={760}>
                <Table verticalSpacing={4} styles={{ td: { whiteSpace: 'nowrap' } }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Работа</Table.Th>
                      {f.status && <Table.Th w={190}>Статус</Table.Th>}
                      <Table.Th w={150}>Факт</Table.Th>
                      {f.ks && <Table.Th w={170}>КС-2, ₽</Table.Th>}
                      {f.paid && <Table.Th w={170}>Оплачено, ₽</Table.Th>}
                      <Table.Th>Примечание</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {site.items.map((i) => {
                      const v = { ...i.value, ...draft.items[i.id] };
                      const d = (k: keyof EntryValue) => draft.items[i.id]?.[k] !== undefined;
                      const byQty = i.planQty != null || i.value.factQty != null;
                      return (
                        <Table.Tr key={i.id}>
                          <Table.Td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                            <Text size="sm" fw={500}>
                              {i.name}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {[i.group, i.planEnd ? `до ${date(i.planEnd)}` : null, byQty ? (i.planQty == null ? 'проектный объём не указан' : `проект ${i.planQty} ${i.unit ?? ''}`) : null]
                                .filter(Boolean)
                                .join(' · ')}
                              {i.version == null && i.from ? ` · значение с ${date(i.from)}` : ''}
                              {i.version != null && i.enteredBy ? ` · ${i.enteredBy}` : ''}
                            </Text>
                            <DelayReason code={sheet.direction.code} periodId={sheet.period.id} workItemId={i.id} />
                          </Table.Td>
                          {f.status && (
                            <Table.Td>
                              <Select
                                size="xs"
                                data={statusData}
                                disabled={ro}
                                value={v.statusCode}
                                allowDeselect={false}
                                styles={dirtyStyle(d('statusCode'))}
                                onChange={(x) => setItem(i.id, i.value, { statusCode: x })}
                              />
                            </Table.Td>
                          )}
                          <Table.Td>
                            {byQty ? (
                              <Tooltip label={i.planQty == null ? 'Проектный объём не указан' : `из ${i.planQty} ${i.unit ?? ''}`}>
                                <NumberInput
                                  aria-label={`Факт: ${i.name}`}
                                  size="xs"
                                  min={0}
                                  disabled={ro}
                                  value={v.factQty ?? ''}
                                  suffix={i.unit ? ` ${i.unit}` : undefined}
                                  decimalSeparator=","
                                  styles={dirtyStyle(d('factQty'))}
                                  onChange={(x) =>
                                    setItem(i.id, i.value, {
                                      factQty: numOrNull(x),
                                    })
                                  }
                                />
                              </Tooltip>
                            ) : (
                              <NumberInput
                                size="xs"
                                min={0}
                                max={100}
                                clampBehavior="strict"
                                disabled={ro}
                                value={v.pct ?? ''}
                                suffix=" %"
                                decimalSeparator=","
                                styles={dirtyStyle(d('pct'))}
                                onChange={(x) => setItem(i.id, i.value, { pct: numOrNull(x) })}
                              />
                            )}
                          </Table.Td>
                          {f.ks && (
                            <Table.Td>
                              <NumberInput
                                size="xs"
                                min={0}
                                thousandSeparator=" "
                                decimalSeparator=","
                                disabled={ro}
                                value={v.ks ?? ''}
                                styles={dirtyStyle(d('ks'))}
                                onChange={(x) => setItem(i.id, i.value, { ks: numOrNull(x) })}
                              />
                            </Table.Td>
                          )}
                          {f.paid && (
                            <Table.Td>
                              <NumberInput
                                size="xs"
                                min={0}
                                thousandSeparator=" "
                                decimalSeparator=","
                                disabled={ro}
                                value={v.paid ?? ''}
                                styles={dirtyStyle(d('paid'))}
                                onChange={(x) => setItem(i.id, i.value, { paid: numOrNull(x) })}
                              />
                            </Table.Td>
                          )}
                          <Table.Td>
                            <TextInput
                              size="xs"
                              disabled={ro}
                              value={v.note ?? ''}
                              maxLength={1000}
                              styles={dirtyStyle(d('note'))}
                              onChange={(e) =>
                                setItem(i.id, i.value, {
                                  note: e.currentTarget.value || null,
                                })
                              }
                            />
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}

            {!ro && !site.updated && !changed && (
              <Box>
                <Button size="xs" variant="light" leftSection={<IconCheck size={14} />} loading={saving} onClick={onConfirm}>
                  Без изменений — подтвердить значения
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

/**
 * Позиция на телефоне: крупные поля, быстрые кнопки готовности, примечание — по нажатию.
 * Те же правки, что и в таблице: черновик, подсветка изменённого, сохранение общей кнопкой.
 */
function ItemCard({
  code,
  periodId,
  i,
  v,
  dirty,
  f,
  ro,
  statusData,
  set,
}: {
  code: string;
  periodId: number;
  i: Item;
  v: EntryValue;
  dirty: (k: keyof EntryValue) => boolean;
  f: EntrySheet['fields'];
  ro: boolean;
  statusData: { value: string; label: string }[];
  set: (p: Partial<EntryValue>) => void;
}) {
  const [note, setNote] = useState(!!v.note);
  const num = (x: string | number) => (x === '' || x == null ? null : Number(x));
  const byQty = i.planQty != null || i.value.factQty != null;
  const bump = (d: number) =>
    set({
      pct: Math.min(100, Math.max(0, Math.round(((v.pct ?? 0) + d) * 10) / 10)),
    });
  return (
    <Paper withBorder p="sm" radius="md">
      <Text fw={600}>{i.name}</Text>
      <DelayReason code={code} periodId={periodId} workItemId={i.id} />
      <Text size="xs" c="dimmed" mb={6}>
        {[i.group, i.planEnd ? `до ${date(i.planEnd)}` : null, byQty ? (i.planQty == null ? 'проектный объём не указан' : `проект ${i.planQty} ${i.unit ?? ''}`) : null].filter(Boolean).join(' · ')}
        {i.version == null && i.from ? ` · значение с ${date(i.from)}` : ''}
      </Text>
      <Stack gap={8}>
        {f.status && (
          <Select
            size="md"
            label="Статус"
            data={statusData}
            disabled={ro}
            value={v.statusCode}
            allowDeselect={false}
            styles={dirtyStyle(dirty('statusCode'))}
            onChange={(x) => set({ statusCode: x })}
          />
        )}
        {byQty ? (
          <NumberInput
            size="md"
            label={i.planQty == null ? 'Факт (проектный объём не указан)' : `Факт из ${i.planQty} ${i.unit ?? ''}`}
            inputMode="decimal"
            min={0}
            disabled={ro}
            value={v.factQty ?? ''}
            decimalSeparator=","
            styles={dirtyStyle(dirty('factQty'))}
            onChange={(x) => set({ factQty: num(x) })}
          />
        ) : (
          <>
            <NumberInput
              size="md"
              label="Готовность"
              inputMode="decimal"
              min={0}
              max={100}
              clampBehavior="strict"
              suffix=" %"
              disabled={ro}
              value={v.pct ?? ''}
              decimalSeparator=","
              styles={dirtyStyle(dirty('pct'))}
              onChange={(x) => set({ pct: num(x) })}
            />
            {!ro && (
              <Group gap={6} grow>
                <Button variant="default" size="sm" onClick={() => bump(-5)}>
                  −5
                </Button>
                <Button variant="default" size="sm" onClick={() => bump(5)}>
                  +5
                </Button>
                <Button variant="default" size="sm" onClick={() => bump(10)}>
                  +10
                </Button>
                <Button variant="light" size="sm" px={4} onClick={() => set({ pct: 100 })}>
                  100%
                </Button>
              </Group>
            )}
          </>
        )}
        {f.ks && (
          <NumberInput
            size="md"
            label="КС-2, ₽"
            inputMode="decimal"
            min={0}
            thousandSeparator=" "
            decimalSeparator=","
            disabled={ro}
            value={v.ks ?? ''}
            styles={dirtyStyle(dirty('ks'))}
            onChange={(x) => set({ ks: num(x) })}
          />
        )}
        {f.paid && (
          <NumberInput
            size="md"
            label="Оплачено, ₽"
            inputMode="decimal"
            min={0}
            thousandSeparator=" "
            decimalSeparator=","
            disabled={ro}
            value={v.paid ?? ''}
            styles={dirtyStyle(dirty('paid'))}
            onChange={(x) => set({ paid: num(x) })}
          />
        )}
        {note ? (
          <Textarea
            label="Примечание"
            autosize
            minRows={2}
            disabled={ro}
            value={v.note ?? ''}
            maxLength={1000}
            styles={dirtyStyle(dirty('note'))}
            onChange={(e) => set({ note: e.currentTarget.value || null })}
          />
        ) : (
          !ro && (
            <Button variant="subtle" size="xs" style={{ alignSelf: 'flex-start' }} onClick={() => setNote(true)}>
              + примечание
            </Button>
          )
        )}
      </Stack>
    </Paper>
  );
}
