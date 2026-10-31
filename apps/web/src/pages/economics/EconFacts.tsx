import { Fragment, useMemo, useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, List, Modal, NumberInput, Paper, Select, SimpleGrid, Skeleton, Stack, Table, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle, IconClockHour4, IconDownload, IconFileImport, IconLock, IconLockOpen, IconCheck, IconDeviceFloppy } from '@tabler/icons-react';
import {
  ECON_MONTH_STATUS_LABELS,
  econDefaultMonth,
  econIsCompanyKind,
  econMonthLabel,
  econMonthSaveSchema,
  econParseNumber,
  type EconArticle,
  type EconBudget,
  type EconFactRow,
  type EconMonthStatus,
  type EconMonthView,
  type EconSetup,
} from '@mvs/shared';
import { api, economicsMonthQuery } from '../../api';
import { parseTable } from '../UsersImport';
import { articleShort } from './EconLimits';
import { budgetCode, downloadCsv, errorText, monthChoices, numOrNull, qty, rub } from './format';
import type { EconomicsSearch } from './search';

interface RowDraft { laborHours: number | null; machineHours: number | null; note: string | null; amounts: Record<string, number | null> }
const COMPANY_CODE = 'ОБЩИЕ';
const statusColor: Record<EconMonthStatus, string> = { OPEN: 'blue', CLOSED: 'teal', LOCKED: 'gray' };
const fromRow = (r?: EconFactRow): RowDraft => ({ laborHours: r?.laborHours ?? null, machineHours: r?.machineHours ?? null, note: r?.note ?? null, amounts: { ...(r?.amounts ?? {}) } });
const sum = (list: (number | null | undefined)[]) => { const v = list.filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) : null; };
const numberProps = { size: 'xs', min: 0, decimalScale: 2, thousandSeparator: ' ', decimalSeparator: ',', hideControls: true } as const;

interface Props { data: EconSetup; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }

export function EconFacts({ data, search, update }: Props) {
  const month = search.month ?? econDefaultMonth();
  const query = useQuery(economicsMonthQuery(month));
  const months = monthChoices(data.months.map((m) => m.month));
  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end">
        <Select
          label="Отчётный месяц"
          w={220}
          data={months.map((m) => ({ value: m, label: `${econMonthLabel(m)}${data.months.some((x) => x.month === m && x.rows) ? ' ·' : ''}` }))}
          value={month}
          onChange={(v) => v && update({ month: v })}
          allowDeselect={false}
          searchable
        />
        <Text size="xs" c="dimmed" mb={6}>Факт вносится за месяц, не нарастающим итогом, после закрытия сч. 20 (к 10 числу следующего месяца). Точка у месяца — данные уже есть.</Text>
      </Group>
      {query.error && !query.data && <Alert color="red">{query.error.message}</Alert>}
      {/* Черновик живёт, пока открыт месяц: фоновое обновление данных его не сбрасывает, устаревшую версию отклонит сервер (409). */}
      {!query.data ? <Skeleton height={320} /> : <MonthSheet key={month} data={data} view={query.data} />}
    </Stack>
  );
}

function MonthSheet({ data, view }: { data: EconSetup; view: EconMonthView }) {
  const qc = useQueryClient();
  const perm = data.permissions;
  const editable = perm.canEdit && view.status === 'OPEN';
  const used = (id: number) => view.rows.some((r) => r.amounts[id] != null) || view.company[id] != null;
  const articles = data.articles.filter((a) => !a.isArchived || used(a.id));
  const direct = articles.filter((a) => !econIsCompanyKind(a.kind));
  const company = articles.filter((a) => econIsCompanyKind(a.kind));
  const budgets = data.budgets.filter((b) => !b.isArchived || view.rows.some((r) => r.budgetId === b.id));
  const rowOf = (id: number) => view.rows.find((r) => r.budgetId === id);
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [companyDraft, setCompanyDraft] = useState<Record<string, number | null> | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const dirty = Object.keys(drafts).length > 0 || companyDraft != null;
  const current = (b: EconBudget) => drafts[b.id] ?? fromRow(rowOf(b.id));
  const companyValues = companyDraft ?? view.company;
  const setRow = (id: number, patch: Partial<RowDraft>) => setDrafts((s) => { const base = s[id] ?? fromRow(rowOf(id)); return { ...s, [id]: { ...base, ...patch } }; });
  const setAmount = (id: number, articleId: number, v: number | null) => setDrafts((s) => { const base = s[id] ?? fromRow(rowOf(id)); return { ...s, [id]: { ...base, amounts: { ...base.amounts, [articleId]: v } } }; });

  async function save() {
    const body = {
      comment: comment.trim() || null,
      rows: Object.entries(drafts).map(([id, d]) => ({ budgetId: Number(id), version: rowOf(Number(id))?.version ?? 0, ...d })),
      company: companyDraft ? { version: view.version, amounts: companyDraft } : undefined,
    };
    const parsed = econMonthSaveSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Проверьте значения');
    setBusy(true);
    setError('');
    try {
      const r = await api<{ saved: number }>(`/economics/months/${view.month}`, { method: 'PUT', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      setDrafts({});
      setCompanyDraft(null);
      setComment('');
      notifications.show({ color: 'green', message: `Сохранено: ${r.saved} ${r.saved === 1 ? 'строка' : 'строк'}${companyDraft ? ' и общие расходы' : ''}` });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: EconMonthStatus) {
    setBusy(true);
    setError('');
    try {
      await api(`/economics/months/${view.month}/status`, { method: 'PUT', body: { status, version: view.version } });
      await qc.invalidateQueries({ queryKey: ['economics'] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function applyImport(rows: Record<number, Partial<RowDraft>>, companyAmounts: Record<string, number | null> | null) {
    setDrafts((s) => {
      const next = { ...s };
      for (const [id, p] of Object.entries(rows)) {
        const base = next[Number(id)] ?? fromRow(rowOf(Number(id)));
        next[Number(id)] = { ...base, ...p, amounts: { ...base.amounts, ...p.amounts } };
      }
      return next;
    });
    if (companyAmounts) setCompanyDraft((c) => ({ ...(c ?? view.company), ...companyAmounts }));
    setComment((c) => c || 'Загрузка из Excel');
    setImporting(false);
  }

  /** Оценка часов из отчётов — только в пустые ячейки открытых центров затрат. */
  function fillHours() {
    setDrafts((s) => {
      const next = { ...s };
      for (const b of budgets.filter((x) => !x.isArchived)) {
        const h = view.reportHours[b.id];
        if (!h) continue;
        const base = next[b.id] ?? fromRow(rowOf(b.id));
        const patch = { laborHours: base.laborHours ?? h.labor, machineHours: base.machineHours ?? h.machine };
        if (patch.laborHours !== base.laborHours || patch.machineHours !== base.machineHours) next[b.id] = { ...base, ...patch };
      }
      return next;
    });
    setComment((c) => c || 'Часы по отчётам дашборда');
  }

  function exportCsv() {
    downloadCsv(`Факт ${econMonthLabel(view.month)}.csv`, [
      ['Код', 'Направление', 'Центр затрат', ...direct.map((a) => a.name), 'Трудочасы', 'Маш.-часы', 'Примечание'],
      ...budgets.map((b) => {
        const r = rowOf(b.id);
        return [budgetCode(b), data.directions.find((d) => d.id === b.directionId)?.name, b.title, ...direct.map((a) => r?.amounts[a.id] ?? null), r?.laborHours ?? null, r?.machineHours ?? null, r?.note ?? ''];
      }),
      [],
      ['Общие расходы компании', '', '', ...company.map((a) => `${a.name}: ${view.company[a.id] ?? ''}`)],
    ]);
  }

  const totals = direct.map((a) => sum(budgets.map((b) => current(b).amounts[a.id])));
  const totalAll = sum(totals);

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="sm">
        <Group gap="xs">
          <Badge size="lg" variant="light" color={statusColor[view.status]} leftSection={view.status === 'OPEN' ? <IconLockOpen size={14} /> : <IconLock size={14} />}>
            {ECON_MONTH_STATUS_LABELS[view.status]}
          </Badge>
          {view.closedBy && view.status !== 'OPEN' && <Text size="xs" c="dimmed">{view.closedBy}, {new Date(view.closedAt!).toLocaleDateString('ru-RU')}</Text>}
        </Group>
        <Group gap="xs">
          {data.canExport && <Button variant="default" size="sm" leftSection={<IconDownload size={16} />} onClick={exportCsv}>Выгрузить (CSV)</Button>}
          {editable && <Button variant="default" size="sm" leftSection={<IconFileImport size={16} />} onClick={() => setImporting(true)}>Загрузить из Excel</Button>}
          {editable && Object.keys(view.reportHours).length > 0 && (
            <Tooltip label="Оценка по отчётам дашборда: люди и техника на объекте × 8 ч в день. Подставляется только в пустые ячейки — проверьте и сохраните." multiline w={300}>
              <Button variant="default" size="sm" leftSection={<IconClockHour4 size={16} />} onClick={fillHours}>Часы из отчётов</Button>
            </Tooltip>
          )}
          {perm.canEdit && view.status === 'OPEN' && <Button variant="light" size="sm" leftSection={<IconCheck size={16} />} onClick={() => setStatus('CLOSED')} loading={busy} disabled={dirty}>Закрыть месяц</Button>}
          {perm.canEdit && view.status === 'CLOSED' && <Button variant="default" size="sm" leftSection={<IconLockOpen size={16} />} onClick={() => setStatus('OPEN')} loading={busy}>Открыть месяц</Button>}
          {perm.canAdmin && view.status !== 'LOCKED' && <Button variant="default" size="sm" leftSection={<IconLock size={16} />} onClick={() => setStatus('LOCKED')} loading={busy} disabled={dirty}>Заблокировать</Button>}
          {perm.canAdmin && view.status === 'LOCKED' && <Button variant="default" size="sm" leftSection={<IconLockOpen size={16} />} onClick={() => setStatus('CLOSED')} loading={busy}>Разблокировать</Button>}
        </Group>
      </Group>
      {perm.canEdit && view.status !== 'OPEN' && <Alert color="gray" icon={<IconLock size={16} />}>Месяц {view.status === 'LOCKED' ? 'заблокирован администратором' : 'закрыт'} — правки невозможны.</Alert>}

      {!budgets.length ? (
        <Alert color="gray">Нет центров затрат. Добавьте их на вкладке «Лимиты».</Alert>
      ) : (
        <Paper withBorder radius="md">
          <Table.ScrollContainer minWidth={300 + direct.length * 140 + 380}>
            <Table verticalSpacing={4} fz="sm" stickyHeader className="econ-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th miw={220}>Центр затрат</Table.Th>
                  {direct.map((a) => <Table.Th key={a.id} ta="right" miw={130}><Tooltip label={a.name}><span>{articleShort(a)}, ₽</span></Tooltip></Table.Th>)}
                  <Table.Th ta="right" miw={110}>Трудочасы</Table.Th>
                  <Table.Th ta="right" miw={110}>Маш.-часы</Table.Th>
                  <Table.Th miw={160}>Примечание</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.directions.map((d) => {
                  const list = budgets.filter((b) => b.directionId === d.id);
                  if (!list.length) return null;
                  return (
                    <Fragment key={d.id}>
                      <Table.Tr bg="var(--mantine-color-default-hover)">
                        <Table.Td colSpan={direct.length + 4}><Text size="sm" fw={600}>{d.shortName}</Text></Table.Td>
                      </Table.Tr>
                      {list.map((b) => {
                        const v = current(b);
                        const r = rowOf(b.id);
                        const can = editable && !b.isArchived;
                        return (
                          <Table.Tr key={b.id} bg={drafts[b.id] ? 'var(--mantine-color-yellow-light)' : undefined}>
                            <Table.Td>
                              <Text size="sm" lineClamp={2}>{b.title}</Text>
                              <Text size="xs" c="dimmed">{budgetCode(b)}{r?.updatedBy ? ` · ${r.updatedBy}, ${new Date(r.updatedAt!).toLocaleDateString('ru-RU')}` : ''}{b.isArchived ? ' · архив' : ''}</Text>
                            </Table.Td>
                            {direct.map((a) => (
                              <Table.Td key={a.id} ta="right">
                                {can ? <NumberInput {...numberProps} value={v.amounts[a.id] ?? ''} onChange={(x) => setAmount(b.id, a.id, numOrNull(x))} aria-label={`${b.title}: ${a.name}`} /> : rub(v.amounts[a.id])}
                              </Table.Td>
                            ))}
                            <Table.Td ta="right">
                              {can ? <NumberInput {...numberProps} value={v.laborHours ?? ''} onChange={(x) => setRow(b.id, { laborHours: numOrNull(x) })} aria-label={`${b.title}: трудочасы`} /> : qty(v.laborHours)}
                              <ReportHint value={view.reportHours[b.id]?.labor} days={view.reportHours[b.id]?.days} onApply={can ? (x) => setRow(b.id, { laborHours: x }) : undefined} />
                            </Table.Td>
                            <Table.Td ta="right">
                              {can ? <NumberInput {...numberProps} value={v.machineHours ?? ''} onChange={(x) => setRow(b.id, { machineHours: numOrNull(x) })} aria-label={`${b.title}: машино-часы`} /> : qty(v.machineHours)}
                              <ReportHint value={view.reportHours[b.id]?.machine} days={view.reportHours[b.id]?.days} onApply={can ? (x) => setRow(b.id, { machineHours: x }) : undefined} />
                            </Table.Td>
                            <Table.Td>{can ? <Textarea size="xs" autosize maxRows={3} value={v.note ?? ''} onChange={(e) => setRow(b.id, { note: e.currentTarget.value || null })} aria-label={`${b.title}: примечание`} /> : <Text size="xs">{v.note}</Text>}</Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                <Table.Tr>
                  <Table.Td fw={600}>Итого прямые расходы: {rub(totalAll)}</Table.Td>
                  {totals.map((t, i) => <Table.Td key={direct[i].id} ta="right" fw={600}>{rub(t)}</Table.Td>)}
                  <Table.Td ta="right" fw={600}>{qty(sum(budgets.map((b) => current(b).laborHours)))}</Table.Td>
                  <Table.Td ta="right" fw={600}>{qty(sum(budgets.map((b) => current(b).machineHours)))}</Table.Td>
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {company.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Text fw={600}>Общие расходы компании за месяц</Text>
          <Text size="xs" c="dimmed" mb="sm">Вносятся одной суммой; на следующем этапе разносятся по объектам пропорционально выручке.</Text>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {company.map((a) => (
              <NumberInput
                key={a.id}
                label={a.name}
                {...numberProps}
                size="sm"
                value={companyValues[a.id] ?? ''}
                onChange={(x) => setCompanyDraft((c) => ({ ...(c ?? view.company), [a.id]: numOrNull(x) }))}
                disabled={!editable}
                suffix=" ₽"
              />
            ))}
          </SimpleGrid>
        </Paper>
      )}

      {error && <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>}
      {editable && dirty && (
        <Paper withBorder p="sm" radius="md" style={{ position: 'sticky', bottom: 8, zIndex: 5 }}>
          <Group justify="space-between" gap="sm">
            <Text size="sm">Изменено строк: {Object.keys(drafts).length}{companyDraft ? ' и общие расходы' : ''}</Text>
            <Group gap="xs">
              <Textarea size="xs" w={260} autosize maxRows={2} placeholder="Комментарий для журнала (необязательно)" value={comment} onChange={(e) => setComment(e.currentTarget.value)} aria-label="Комментарий к сохранению" />
              <Button variant="default" onClick={() => { setDrafts({}); setCompanyDraft(null); setError(''); }} disabled={busy}>Отменить</Button>
              <Button leftSection={<IconDeviceFloppy size={16} />} loading={busy} onClick={save}>Сохранить</Button>
            </Group>
          </Group>
        </Paper>
      )}

      {importing && <ImportDialog data={data} month={view.month} direct={direct} company={company} budgets={budgets.filter((b) => !b.isArchived)} onClose={() => setImporting(false)} onApply={applyImport} />}
    </Stack>
  );
}

/** Файл из Excel: CSV в UTF-8 или в кодировке Windows (Excel сохраняет CSV в ней по умолчанию). */
async function readText(f: File) {
  const buf = await f.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  return utf.includes('�') ? new TextDecoder('windows-1251').decode(buf) : utf.replace(/^﻿/, '');
}

const norm = (s: string) => s.toLocaleLowerCase('ru').replace(/[«»"']/g, '').replace(/,?\s*₽$/, '').replace(/\s+/g, ' ').trim();

interface ImportResult { rows: Record<number, Partial<RowDraft>>; company: Record<string, number | null> | null; matched: number; problems: string[] }

function ImportDialog({ data, month, direct, company, budgets, onClose, onApply }: {
  data: EconSetup; month: string; direct: EconArticle[]; company: EconArticle[]; budgets: EconBudget[]; onClose: () => void; onApply: (rows: ImportResult['rows'], company: ImportResult['company']) => void;
}) {
  const mobile = useMediaQuery('(max-width: 48em)');
  const [text, setText] = useState('');
  const dirName = (b: EconBudget) => data.directions.find((d) => d.id === b.directionId)?.shortName ?? '';

  function template() {
    downloadCsv(`Шаблон факта ${econMonthLabel(month)}.csv`, [
      ['Код', 'Направление', 'Центр затрат', ...direct.map((a) => a.name), ...company.map((a) => a.name), 'Трудочасы', 'Маш.-часы', 'Примечание'],
      ...budgets.map((b) => [budgetCode(b), dirName(b), b.title, ...direct.map(() => ''), ...company.map(() => ''), '', '', '']),
      [COMPANY_CODE, '', 'Общие расходы компании', ...direct.map(() => ''), ...company.map(() => ''), '', '', ''],
    ]);
  }

  const result = useMemo<ImportResult | null>(() => {
    const table = parseTable(text);
    if (table.length < 2) return null;
    const head = table[0].map(norm);
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === norm(n)));
    const iCode = col('Код');
    const iTitle = col('Центр затрат', 'Объект');
    const iDir = col('Направление');
    const iLabor = col('Трудочасы', 'Факт трудочасов');
    const iMachine = col('Маш.-часы', 'Машино-часы');
    const iNote = col('Примечание');
    const directCols = direct.map((a) => ({ a, i: col(a.name, articleShort(a)) })).filter((x) => x.i >= 0);
    const companyCols = company.map((a) => ({ a, i: col(a.name, articleShort(a)) })).filter((x) => x.i >= 0);
    const problems: string[] = [];
    if (iCode < 0 && iTitle < 0) problems.push('Нет столбца «Код» или «Центр затрат» — строки не с чем сопоставить. Скачайте шаблон.');
    if (!directCols.length && !companyCols.length) problems.push('Не найдено ни одного столбца со статьями расходов: названия столбцов должны совпадать со статьями.');
    const rows: ImportResult['rows'] = {};
    let companyAmounts: ImportResult['company'] = null;
    let matched = 0;
    const cell = (r: string[], i: number, where: string) => {
      if (i < 0) return undefined;
      const v = econParseNumber(r[i] ?? '');
      if (v == null) return undefined; // пустая ячейка не меняет внесённое значение
      if (Number.isNaN(v) || v < 0) { problems.push(`${where}: «${r[i]}» — не число`); return undefined; }
      return v;
    };
    table.slice(1).forEach((r, n) => {
      const line = `Строка ${n + 2}`;
      const code = iCode >= 0 ? (r[iCode] ?? '').trim() : '';
      if (code.toUpperCase() === COMPANY_CODE || (iTitle >= 0 && norm(r[iTitle] ?? '') === norm('Общие расходы компании'))) {
        const amounts: Record<string, number | null> = {};
        for (const { a, i } of companyCols) { const v = cell(r, i, `${line}, ${a.name}`); if (v !== undefined) amounts[a.id] = v; }
        if (Object.keys(amounts).length) { companyAmounts = amounts; matched++; }
        return;
      }
      const byCode = /^цз-(\d+)$/i.exec(code);
      let b = byCode ? budgets.find((x) => x.id === Number(byCode[1])) : undefined;
      if (!b && iTitle >= 0) {
        const title = norm(r[iTitle] ?? '');
        const dir = iDir >= 0 ? norm(r[iDir] ?? '') : '';
        const found = budgets.filter((x) => norm(x.title) === title && (!dir || norm(dirName(x)) === dir || norm(data.directions.find((d) => d.id === x.directionId)?.name ?? '') === dir));
        if (found.length === 1) b = found[0];
        else if (found.length > 1) { problems.push(`${line}: «${r[iTitle]}» есть в нескольких направлениях — укажите код`); return; }
      }
      if (!b) { if (r.some((x) => x.trim())) problems.push(`${line}: центр затрат «${code || r[iTitle] || '—'}» не найден`); return; }
      const p: Partial<RowDraft> & { amounts: Record<string, number | null> } = { amounts: {} };
      for (const { a, i } of directCols) { const v = cell(r, i, `${line}, ${a.name}`); if (v !== undefined) p.amounts[a.id] = v; }
      for (const { a, i } of companyCols) if (econParseNumber(r[i] ?? '') != null) problems.push(`${line}: «${a.name}» вносится общей суммой в строке «${COMPANY_CODE}» — значение пропущено`);
      const labor = cell(r, iLabor, `${line}, трудочасы`);
      const machine = cell(r, iMachine, `${line}, маш.-часы`);
      if (labor !== undefined) p.laborHours = labor;
      if (machine !== undefined) p.machineHours = machine;
      if (iNote >= 0 && (r[iNote] ?? '').trim()) p.note = r[iNote].trim().slice(0, 2000);
      if (Object.keys(p.amounts).length || p.laborHours != null || p.machineHours != null || p.note) { rows[b.id] = p; matched++; }
    });
    return { rows, company: companyAmounts, matched, problems };
  }, [text, direct, company, budgets, data.directions]);

  return (
    <Modal opened onClose={onClose} title={`Загрузка факта из Excel — ${econMonthLabel(month)}`} size="xl" fullScreen={mobile}>
      <Stack gap="sm">
        <List size="sm" type="ordered" spacing={4}>
          <List.Item>Скачайте шаблон: в нём все центры затрат с кодами и столбцы статей.</List.Item>
          <List.Item>Заполните суммы без НДС за месяц (не нарастающим итогом), часы — по объектам. Общие расходы — в строке «{COMPANY_CODE}».</List.Item>
          <List.Item>Скопируйте таблицу из Excel вместе с заголовком и вставьте ниже или выберите сохранённый CSV.</List.Item>
        </List>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={template}>Скачать шаблон</Button>
          <FileButton accept=".csv,.txt" onChange={(f) => f && readText(f).then(setText)}>
            {(props) => <Button variant="default" leftSection={<IconFileImport size={16} />} {...props}>Выбрать файл CSV</Button>}
          </FileButton>
        </Group>
        <Textarea label="Таблица из Excel" placeholder="Вставьте сюда диапазон из Excel (Ctrl+V)" value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={6} maxRows={14} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }} />
        <Text size="xs" c="dimmed">Пустые ячейки не меняют уже внесённые значения; чтобы обнулить сумму, поставьте 0. Данные попадут в форму — проверьте их и нажмите «Сохранить».</Text>
        {result && (
          <Alert color={result.problems.length ? 'yellow' : 'green'} title={`Найдено строк: ${result.matched}`}>
            {result.problems.length > 0 && (
              <List size="xs" spacing={2}>
                {result.problems.slice(0, 15).map((p, i) => <List.Item key={i}>{p}</List.Item>)}
                {result.problems.length > 15 && <List.Item>…и ещё {result.problems.length - 15}</List.Item>}
              </List>
            )}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button disabled={!result?.matched} onClick={() => result && onApply(result.rows, result.company)}>Подставить в форму</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Подсказка под ячейкой часов: оценка по отчётам дашборда, нажатие подставляет её. */
function ReportHint({ value, days, onApply }: { value: number | null | undefined; days?: number; onApply?: (v: number) => void }) {
  if (value == null) return null;
  const text = `отчёты ≈ ${qty(Math.round(value))}`;
  return (
    <Tooltip label={`Люди или техника на объектах по отчётам дашборда × 8 ч в день; отчётных дней: ${days ?? 0}${onApply ? '. Нажмите, чтобы подставить' : ''}`} multiline w={260}>
      {onApply ? (
        <UnstyledButton onClick={() => onApply(Math.round(value))} mt={2}><Text size="xs" c="var(--series-1)" td="underline" style={{ textDecorationStyle: 'dotted' }}>{text}</Text></UnstyledButton>
      ) : (
        <Text size="xs" c="dimmed" mt={2}>{text}</Text>
      )}
    </Tooltip>
  );
}
