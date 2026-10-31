import { useMemo, useState } from 'react';
import { Alert, Button, Group, List, Menu, Modal, NumberInput, Paper, SegmentedControl, Select, Stack, Table, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { IconChevronDown, IconDeviceFloppy, IconFileImport, IconLock, IconWand } from '@tabler/icons-react';
import { ECON_CASH_COMPANY, ECON_CASH_INFLOW_BY_DIRECTION, econCashSaveSchema, econMonthLabel, econParseNumber, econYearMonths, type EconCashView, type EconSetup } from '@mvs/shared';
import { api } from '../../api';
import { parseTable } from '../UsersImport';
import { errorText, numOrNull, rub } from './format';
import type { EconomicsSearch } from './search';

type Kind = 'plan' | 'fact';
type Grid = Record<string, { plan: number | null; fact: number | null }>;
const key = (month: string, articleId: number) => `${month}|${articleId}`;
const short = (m: string) => econMonthLabel(m).slice(0, 3).toLowerCase();
const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function EconCashEntry({ data, view, search, update }: { data: EconSetup; view: EconCashView; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }) {
  const scope = view.scopes.some((s) => s.scope === search.scope) ? search.scope! : view.scopes[0]?.scope;
  const sheet = view.sheets.find((s) => s.scope === scope);
  // черновик живёт, пока открыта таблица; при смене таблицы или года — заново
  return sheet ? <Sheet key={`${scope}:${view.year}`} data={data} view={view} scope={scope} update={update} /> : <Alert color="gray">Нет доступных таблиц ДДС.</Alert>;
}

function Sheet({ data, view, scope, update }: { data: EconSetup; view: EconCashView; scope: string; update: (p: Partial<EconomicsSearch>) => void }) {
  const qc = useQueryClient();
  const sheet = view.sheets.find((s) => s.scope === scope)!;
  const meta = view.scopes.find((s) => s.scope === scope)!;
  const hints = view.hints[scope];
  const canEdit = data.permissions.canEdit;
  const months = econYearMonths(view.year);
  const closed = (m: string) => (view.monthStatus[m] ?? 'OPEN') !== 'OPEN';
  const initial = useMemo<Grid>(() => Object.fromEntries(sheet.entries.map((e) => [key(e.month, e.articleId), { plan: e.plan, fact: e.fact }])), [sheet]);
  const [grid, setGrid] = useState<Grid>(initial);
  const [opening, setOpening] = useState<number | null>(sheet.opening);
  const [kind, setKind] = useState<Kind>('fact');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [importing, setImporting] = useState(false);
  const dirty = JSON.stringify(grid) !== JSON.stringify(initial) || opening !== sheet.opening;
  const ins = view.articles.filter((a) => a.kind === 'IN' && (!a.isArchived || sheet.entries.some((e) => e.articleId === a.id)));
  const outs = view.articles.filter((a) => a.kind === 'OUT' && (!a.isArchived || sheet.entries.some((e) => e.articleId === a.id)));
  const value = (m: string, id: number) => grid[key(m, id)]?.[kind] ?? null;
  const set = (m: string, id: number, v: number | null) => setGrid((g) => ({ ...g, [key(m, id)]: { plan: g[key(m, id)]?.plan ?? null, fact: g[key(m, id)]?.fact ?? null, [kind]: v } }));
  const sum = (ids: number[], m?: string) => (m ? [m] : months).reduce((a, mm) => a + ids.reduce((b, id) => b + (grid[key(mm, id)]?.[kind] ?? 0), 0), 0);
  const editable = (m: string) => canEdit && !closed(m);
  const dirCode = data.directions.find((d) => d.id === meta.directionId)?.code;
  const inflowId = view.articles.find((a) => a.code === (ECON_CASH_INFLOW_BY_DIRECTION[dirCode ?? ''] ?? 'in_commercial'))?.id;
  const today = new Date().toISOString().slice(0, 7);

  /** Подсказка ячейки: факт выплат — расходы ПЭО × НДС; факт поступлений — оплата заказчика по дашборду. */
  const hint = (m: string, id: number): number | null => {
    if (kind !== 'fact' || !hints) return null;
    if (id === inflowId) return hints.paid[m] ?? null;
    return hints.costs[m]?.[id] ?? null;
  };

  function fillFacts() {
    setGrid((g) => {
      const next = { ...g };
      for (const m of months.filter(editable))
        for (const a of [...ins, ...outs]) {
          const h = a.id === inflowId ? hints?.paid[m] : hints?.costs[m]?.[a.id];
          const cur = next[key(m, a.id)];
          if (h != null && cur?.fact == null) next[key(m, a.id)] = { plan: cur?.plan ?? null, fact: Math.round(h * 100) / 100 };
        }
      return next;
    });
    setComment((c) => c || 'Факт по расходам ПЭО и оплате в дашборде');
  }

  /** План выплат: остаток лимита (с НДС) за вычетом факта года — поровну на открытые месяцы с текущего, только в пустые ячейки. */
  function fillPlanByLimits() {
    const target = months.filter((m) => m >= today && editable(m));
    if (!target.length || !hints) return;
    setGrid((g) => {
      const next = { ...g };
      for (const a of outs) {
        const limit = hints.limits[a.id];
        if (!limit) continue;
        const paid = months.reduce((s, m) => s + (next[key(m, a.id)]?.fact ?? 0), 0);
        const rest = Math.max(0, limit - paid);
        const empty = target.filter((m) => next[key(m, a.id)]?.plan == null);
        for (const m of empty) next[key(m, a.id)] = { plan: Math.round((rest / target.length) * 100) / 100, fact: next[key(m, a.id)]?.fact ?? null };
      }
      return next;
    });
    setComment((c) => c || 'План выплат по остатку лимитов');
  }

  async function save() {
    const entries = Object.entries(grid)
      .map(([k, v]) => { const [month, id] = k.split('|'); return { month, articleId: Number(id), plan: v.plan, fact: v.fact }; })
      .filter((e) => e.plan != null || e.fact != null);
    const body = { version: sheet.version, opening: scope === ECON_CASH_COMPANY ? opening : undefined, entries, comment: comment.trim() || null };
    const parsed = econCashSaveSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Проверьте значения');
    setBusy(true);
    setError('');
    try {
      await api(`/economics/cash/${view.year}/${scope}`, { method: 'PUT', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics', 'cash'] });
      notifications.show({ color: 'green', message: 'ДДС сохранён' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const row = (a: { id: number; name: string }) => (
    <Table.Tr key={a.id}>
      <Table.Td><Text size="sm" lineClamp={2}>{a.name}</Text></Table.Td>
      {months.map((m) => {
        const h = hint(m, a.id);
        return (
          <Table.Td key={m} p={3} bg={closed(m) ? 'var(--mantine-color-default-hover)' : undefined}>
            {editable(m) ? (
              <NumberInput size="xs" w={112} value={value(m, a.id) ?? ''} onChange={(x) => set(m, a.id, numOrNull(x))} min={0} decimalScale={2} thousandSeparator=" " decimalSeparator="," hideControls aria-label={`${a.name}, ${econMonthLabel(m)}, ${kind === 'plan' ? 'план' : 'факт'}`} />
            ) : (
              <Text size="xs" ta="right" w={112}>{value(m, a.id) == null ? '—' : rub(value(m, a.id))}</Text>
            )}
            {h != null && (
              <Tooltip label={a.id === inflowId ? 'Оплата заказчика за месяц по дашборду (с НДС). Нажмите, чтобы подставить.' : 'Факт расходов ПЭО за месяц с НДС. Нажмите, чтобы подставить.'} multiline w={260}>
                <UnstyledButton disabled={!editable(m)} onClick={() => set(m, a.id, Math.round(h * 100) / 100)}>
                  <Text size="xs" c="dimmed" ta="right" w={112}>≈ {rub(h)}</Text>
                </UnstyledButton>
              </Tooltip>
            )}
          </Table.Td>
        );
      })}
      <Table.Td ta="right" fw={600}>{rub(sum([a.id]) || null)}</Table.Td>
    </Table.Tr>
  );
  const total = (label: string, ids: number[], sign = 1, other?: number[]) => (
    <Table.Tr bg="var(--mantine-color-default-hover)">
      <Table.Td><Text size="sm" fw={650}>{label}</Text></Table.Td>
      {months.map((m) => { const v = sign * sum(ids, m) - (other ? sum(other, m) : 0); return <Table.Td key={m} ta="right" fw={600} c={v < 0 ? 'var(--status-critical)' : undefined}>{v ? rub(v) : '—'}</Table.Td>; })}
      <Table.Td ta="right" fw={650}>{rub(sign * sum(ids) - (other ? sum(other) : 0) || null)}</Table.Td>
    </Table.Tr>
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" gap="sm">
        <Group gap="sm" align="flex-end">
          <Select label="Таблица" w={240} data={view.scopes.map((s) => ({ value: s.scope, label: s.title }))} value={scope} onChange={(v) => v && update({ scope: v })} allowDeselect={false} disabled={dirty} />
          <SegmentedControl value={kind} onChange={(v) => setKind(v as Kind)} data={[{ value: 'fact', label: 'Факт' }, { value: 'plan', label: 'План' }]} />
          {scope === ECON_CASH_COMPANY && (
            <NumberInput label={`Остаток денег на 1 января ${view.year}`} w={240} value={opening ?? ''} onChange={(v) => setOpening(numOrNull(v))} decimalScale={2} thousandSeparator=" " decimalSeparator="," hideControls disabled={!canEdit} allowNegative />
          )}
        </Group>
        {canEdit && (
          <Group gap="xs">
            <Menu position="bottom-end" withinPortal>
              <Menu.Target><Button variant="default" leftSection={<IconWand size={16} />} rightSection={<IconChevronDown size={14} />}>Заполнить</Button></Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => { setKind('fact'); fillFacts(); }}>Факт: расходы ПЭО с НДС и оплата заказчика</Menu.Item>
                <Menu.Item disabled={scope === ECON_CASH_COMPANY} onClick={() => { setKind('plan'); fillPlanByLimits(); }}>План выплат по остатку лимитов</Menu.Item>
                <Menu.Label>Заполняются только пустые ячейки открытых месяцев</Menu.Label>
              </Menu.Dropdown>
            </Menu>
            <Button variant="default" leftSection={<IconFileImport size={16} />} onClick={() => setImporting(true)}>Вставить из Excel</Button>
          </Group>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        {meta.title}, {view.year}: {kind === 'plan' ? 'план' : 'факт'} по месяцам, рубли с НДС. Закрытые месяцы (серые) не правятся.
        {sheet.updatedBy ? ` Изменил: ${sheet.updatedBy}, ${new Date(sheet.updatedAt!).toLocaleDateString('ru-RU')}.` : ''}
        {kind === 'fact' && hints ? ' Под ячейками — подсказки: факт расходов ПЭО с НДС и оплата заказчика по дашборду.' : ''}
      </Text>

      <Paper withBorder radius="md">
        <Table.ScrollContainer minWidth={240 + 12 * 122 + 140}>
          <Table verticalSpacing={3} fz="sm" className="econ-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th miw={220}>Статья</Table.Th>
                {months.map((m) => (
                  <Table.Th key={m} ta="right">{closed(m) && <IconLock size={12} aria-label="закрыт" />} {short(m)}</Table.Th>
                ))}
                <Table.Th ta="right">Итого</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {total('Поступления', ins.map((a) => a.id))}
              {ins.map(row)}
              {total('Выплаты', outs.map((a) => a.id))}
              {outs.map(row)}
              {total('Чистый поток', ins.map((a) => a.id), 1, outs.map((a) => a.id))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      {error && <Alert color="red">{error}</Alert>}
      {canEdit && dirty && (
        <Paper withBorder p="sm" radius="md" style={{ position: 'sticky', bottom: 8, zIndex: 5 }}>
          <Group justify="space-between" gap="sm">
            <Text size="sm">Есть несохранённые изменения</Text>
            <Group gap="xs">
              <Textarea size="xs" w={260} autosize maxRows={2} placeholder="Комментарий для журнала (необязательно)" value={comment} onChange={(e) => setComment(e.currentTarget.value)} aria-label="Комментарий к сохранению" />
              <Button variant="default" onClick={() => { setGrid(initial); setOpening(sheet.opening); setError(''); }} disabled={busy}>Отменить</Button>
              <Button leftSection={<IconDeviceFloppy size={16} />} loading={busy} onClick={save}>Сохранить</Button>
            </Group>
          </Group>
        </Paper>
      )}
      {importing && (
        <PasteDialog
          kind={kind}
          months={months}
          articles={[...ins, ...outs]}
          editable={editable}
          onClose={() => setImporting(false)}
          onApply={(values) => {
            setGrid((g) => {
              const next = { ...g };
              for (const [k, v] of Object.entries(values)) next[k] = { plan: next[k]?.plan ?? null, fact: next[k]?.fact ?? null, [kind]: v };
              return next;
            });
            setComment((c) => c || 'Вставка из Excel');
            setImporting(false);
          }}
        />
      )}
    </Stack>
  );
}

/** Вставка из Excel: строки — статьи ДДС (по названию), столбцы — месяцы (янв…дек, 01…12 или ГГГГ-ММ). */
function PasteDialog({ kind, months, articles, editable, onClose, onApply }: {
  kind: Kind; months: string[]; articles: { id: number; name: string }[]; editable: (m: string) => boolean; onClose: () => void; onApply: (values: Record<string, number | null>) => void;
}) {
  const [text, setText] = useState('');
  const norm = (s: string) => s.toLocaleLowerCase('ru').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
  const result = useMemo(() => {
    const t = parseTable(text);
    if (t.length < 2) return null;
    const head = t[0].map(norm);
    const monthCol = new Map<number, string>();
    head.forEach((h, i) => {
      const iso = /^(20\d{2})-(\d{2})$/.exec(h);
      const n = /^(\d{1,2})$/.exec(h);
      const idx = iso ? months.indexOf(h) : n ? Number(n[1]) - 1 : MONTH_NAMES.findIndex((x) => h.startsWith(x));
      if (idx >= 0 && idx < 12 && months[idx]) monthCol.set(i, months[idx]);
    });
    const values: Record<string, number | null> = {};
    const problems: string[] = [];
    let matched = 0;
    if (!monthCol.size) problems.push('Не найдены столбцы месяцев: в заголовке нужны «янв…дек», номера 1–12 или «ГГГГ-ММ».');
    t.slice(1).forEach((r, n) => {
      const name = norm(r[0] ?? '');
      if (!name) return;
      const a = articles.find((x) => norm(x.name) === name) ?? articles.find((x) => norm(x.name).startsWith(name) || name.startsWith(norm(x.name)));
      if (!a) return problems.push(`Строка ${n + 2}: статья «${r[0]}» не найдена`);
      matched++;
      for (const [i, m] of monthCol) {
        const v = econParseNumber(r[i] ?? '');
        if (v == null) continue;
        if (Number.isNaN(v) || v < 0) { problems.push(`Строка ${n + 2}, ${econMonthLabel(m)}: «${r[i]}» — не число`); continue; }
        if (!editable(m)) { problems.push(`${econMonthLabel(m)} закрыт — «${a.name}» пропущено`); continue; }
        values[key(m, a.id)] = v;
      }
    });
    return { values, problems, matched };
  }, [text, months, articles, editable]);
  return (
    <Modal opened onClose={onClose} title={`Вставка ${kind === 'plan' ? 'плана' : 'факта'} ДДС из Excel`} size="xl">
      <Stack gap="sm">
        <List size="sm" spacing={4}>
          <List.Item>Первая строка — заголовок: «Статья», затем месяцы (янв…дек, 1…12 или ГГГГ-ММ).</List.Item>
          <List.Item>Первый столбец — названия статей ДДС, как в таблице. Суммы — с НДС, в рублях.</List.Item>
          <List.Item>Пустые ячейки не меняют внесённое; закрытые месяцы пропускаются.</List.Item>
        </List>
        <Textarea label="Таблица из Excel" placeholder="Вставьте диапазон из Excel (Ctrl+V)" value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={6} maxRows={14} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }} />
        {result && (
          <Alert color={result.problems.length ? 'yellow' : 'green'} title={`Статей: ${result.matched}, значений: ${Object.keys(result.values).length}`}>
            {result.problems.length > 0 && <List size="xs">{result.problems.slice(0, 12).map((p, i) => <List.Item key={i}>{p}</List.Item>)}</List>}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button disabled={!result || !Object.keys(result.values).length} onClick={() => result && onApply(result.values)}>Подставить в таблицу</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

