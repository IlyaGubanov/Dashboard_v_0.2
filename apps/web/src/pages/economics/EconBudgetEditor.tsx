import { useMemo, useState } from 'react';
import { Alert, Badge, Box, Button, Checkbox, Group, Menu, Modal, NumberInput, Paper, Popover, Progress, SegmentedControl, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { IconArchive, IconCalculator, IconChevronDown, IconCopy, IconEraser, IconInfoCircle, IconRestore, IconTransferIn } from '@tabler/icons-react';
import { ECON_SCOPE_LABELS, econBudgetSaveSchema, econIsCompanyKind, econLimitValue, econNet, type EconBudget, type EconLimitMethod, type EconSetup } from '@mvs/shared';
import { api, ApiError } from '../../api';
import { money, pct } from '../../ui/format';
import { StatusMark } from './EconOverview';
import { scopeColor } from './EconLimits';
import { articleColor, errorText, numOrNull, qty, rub, share } from './format';

interface LimitDraft { method: EconLimitMethod; sharePct: number | null; amount: number | null; setBy: string; note: string }
const filled = (l: LimitDraft) => (l.method === 'SHARE' ? l.sharePct != null : l.amount != null);
const moneyInput = { min: 0, decimalScale: 2, thousandSeparator: ' ', decimalSeparator: ',', hideControls: true } as const;

/** Карточка центра затрат: данные дашборда, структура стоимости, лимиты по статьям, нормы часов. */
export function BudgetEditor({ budget, data, onClose }: { budget: EconBudget; data: EconSetup; onClose: () => void }) {
  const qc = useQueryClient();
  const mobile = useMediaQuery('(max-width: 48em)');
  const canEdit = data.permissions.canEdit;
  const vat = data.settings.vatRate;
  const articles = data.articles.filter((a) => !a.isArchived || budget.limits.some((l) => l.articleId === a.id));
  const [costNet, setCostNet] = useState<number | null>(budget.costNet);
  const [vatExempt, setVatExempt] = useState(budget.vatExempt);
  const [labor, setLabor] = useState<number | null>(budget.laborHoursNorm);
  const [machine, setMachine] = useState<number | null>(budget.machineHoursNorm);
  const [note, setNote] = useState(budget.note ?? '');
  const [limits, setLimits] = useState<Record<number, LimitDraft>>(() =>
    Object.fromEntries(
      articles.map((a) => {
        const l = budget.limits.find((x) => x.articleId === a.id);
        return [a.id, { method: l?.method ?? 'SHARE', sharePct: l?.sharePct ?? null, amount: l?.amount ?? null, setBy: l?.setBy ?? '', note: l?.note ?? '' }];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const dir = data.directions.find((d) => d.id === budget.directionId);
  const autoNet = econNet(budget.costGross, vat, vatExempt);
  const base = costNet ?? autoNet;
  const values = useMemo(() => Object.fromEntries(articles.map((a) => [a.id, filled(limits[a.id]) ? econLimitValue(limits[a.id], base) : null])), [articles, limits, base]);
  const total = articles.reduce((s, a) => s + (values[a.id] ?? 0), 0);
  const margin = base != null ? base - total : null;
  const change = (id: number, p: Partial<LimitDraft>) => setLimits((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  const byCode = (code: string) => articles.find((a) => a.code === code);
  const fot = byCode('fot');
  const machinery = byCode('machinery');
  const subcontract = byCode('subcontract');

  // образцы долей: другие центры затрат направления и средние доли по направлению
  const siblings = data.budgets.filter((b) => b.id !== budget.id && b.directionId === budget.directionId && !b.isArchived && b.limits.length && b.costBase);
  const shareOf = (b: EconBudget, articleId: number) => { const l = b.limits.find((x) => x.articleId === articleId); return l?.value != null && b.costBase ? (l.value / b.costBase) * 100 : null; };
  function applyShares(get: (articleId: number) => number | null, source: string) {
    setLimits((s) => {
      const next = { ...s };
      for (const a of articles) {
        const v = get(a.id);
        if (v != null) next[a.id] = { ...next[a.id], method: 'SHARE', sharePct: Math.round(v * 1000) / 1000, amount: null, setBy: next[a.id].setBy || source };
      }
      return next;
    });
  }
  const average = (articleId: number) => { const v = siblings.map((b) => shareOf(b, articleId)).filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };

  function payload(isArchived?: boolean) {
    const list = articles.map((a) => ({ a, l: limits[a.id] })).filter(({ l }) => filled(l) || l.setBy.trim() || l.note.trim());
    return {
      version: budget.version,
      costNet,
      vatExempt,
      laborHoursNorm: labor,
      machineHoursNorm: machine,
      note: note.trim() || null,
      isArchived,
      limits: list.map(({ a, l }) => ({ articleId: a.id, method: l.method, sharePct: l.method === 'SHARE' ? l.sharePct : null, amount: l.method === 'AMOUNT' ? l.amount : null, setBy: l.setBy.trim() || null, note: l.note.trim() || null })),
    };
  }

  async function save(isArchived?: boolean) {
    const body = payload(isArchived);
    const parsed = econBudgetSaveSchema.safeParse(body);
    const toField = (path: string) => path.replace(/^limits\.(\d+)\./, (_m, i) => `limit.${body.limits[Number(i)]?.articleId}.`);
    if (!parsed.success) {
      setFields(Object.fromEntries(parsed.error.issues.map((i) => [toField(i.path.join('.')), i.message])));
      setError('Проверьте выделенные поля');
      return;
    }
    setBusy(true);
    setError('');
    setFields({});
    try {
      await api(`/economics/budgets/${budget.id}`, { method: 'PUT', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      notifications.show({ message: isArchived === true ? 'Центр затрат в архиве' : isArchived === false ? 'Центр затрат восстановлен' : 'Лимиты сохранены', color: 'green' });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setFields(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [toField(k), v])));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const ksNet = econNet(budget.ksGross, vat, vatExempt);
  const paidNet = econNet(budget.paidGross, vat, vatExempt);

  return (
    <Modal
      opened
      onClose={onClose}
      size="84rem"
      fullScreen={mobile}
      title={<Group gap="xs"><Badge variant="light" color={scopeColor[budget.scope]}>{ECON_SCOPE_LABELS[budget.scope]}</Badge><Text fw={600}>{dir?.shortName} · {budget.title}</Text></Group>}
    >
      <Stack gap="md">
        {budget.isArchived && <Alert color="gray" icon={<IconArchive size={16} />}>Центр затрат в архиве: факт по нему не вносится.</Alert>}

        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={6}>Из дашборда</Text>
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed">Стоимость, с НДС</Text>
              <Text fw={650}>{money(budget.costGross)}</Text>
              <Text size="xs" c="dimmed">без НДС {money(autoNet)} · объектов {budget.sitesCount}</Text>
            </Paper>
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed">Готовность работ</Text>
              <Text fw={650}>{pct(budget.progress, 0)}</Text>
              <Progress value={(budget.progress ?? 0) * 100} size="sm" mt={4} color="var(--series-1)" aria-hidden />
            </Paper>
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed">КС-2 без НДС</Text>
              <Text fw={650}>{money(ksNet)}</Text>
              <Text size="xs" c="dimmed">оплачено {money(paidNet)}</Text>
            </Paper>
            <Paper withBorder p="sm" radius="md" style={margin != null ? { borderLeft: `4px solid ${margin < 0 ? 'var(--status-critical)' : 'var(--status-good)'}` } : undefined}>
              <Text size="xs" c="dimmed">Плановая маржа</Text>
              <Text fw={650} c={margin != null && margin < 0 ? 'var(--status-critical)' : undefined}>{money(margin)}</Text>
              <Text size="xs" c="dimmed">{share(margin, base)} стоимости без НДС</Text>
            </Paper>
          </SimpleGrid>
        </div>

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput
            label="Стоимость без НДС для расчёта долей, ₽"
            description={autoNet != null ? `Пусто — из дашборда: ${rub(autoNet)}` : 'В дашборде стоимости нет — задайте по сметам'}
            value={costNet ?? ''}
            onChange={(v) => setCostNet(numOrNull(v))}
            {...moneyInput}
            disabled={!canEdit}
            error={fields.costNet}
          />
          <Checkbox mt={{ sm: 28 }} label="Объект без НДС" description={`Субсидии, подрядчик на упрощённой системе: стоимость берётся как есть, без вычета ${vat}%`} checked={vatExempt} onChange={(e) => setVatExempt(e.currentTarget.checked)} disabled={!canEdit} />
        </SimpleGrid>

        <div>
          <Group justify="space-between" mb={6} gap="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Структура стоимости по лимитам</Text>
            {canEdit && (
              <Menu position="bottom-end" withinPortal zIndex={1000}>
                <Menu.Target><Button size="xs" variant="default" rightSection={<IconChevronDown size={14} />} leftSection={<IconCopy size={14} />}>Заполнить доли</Button></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item disabled={!siblings.length} leftSection={<IconCalculator size={16} />} onClick={() => applyShares(average, `средние доли «${dir?.shortName}»`)}>Средние доли по направлению</Menu.Item>
                  {siblings.length > 0 && <Menu.Label>Как у центра затрат</Menu.Label>}
                  {siblings.slice(0, 12).map((b) => <Menu.Item key={b.id} onClick={() => applyShares((id) => shareOf(b, id), `доли как у «${b.title}»`)}>{b.title}</Menu.Item>)}
                  <Menu.Divider />
                  <Menu.Item color="red" leftSection={<IconEraser size={16} />} onClick={() => setLimits((s) => Object.fromEntries(Object.entries(s).map(([k, l]) => [k, { ...l, sharePct: null, amount: null }])))}>Очистить лимиты</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
          {base ? (
            <Group gap={2} wrap="nowrap" h={18} style={{ borderRadius: 4, overflow: 'hidden', background: 'var(--mantine-color-default-hover)' }} aria-hidden>
              {articles.filter((a) => values[a.id]).map((a) => (
                <Tooltip key={a.id} label={`${a.name}: ${rub(values[a.id])} · ${share(values[a.id], base)}`}><Box h="100%" style={{ flex: `${values[a.id]} 0 0`, background: articleColor(data.articles, a.id) }} /></Tooltip>
              ))}
              {margin != null && margin > 0 && <Tooltip label={`Плановая маржа: ${rub(margin)}`}><Box h="100%" style={{ flex: `${margin} 0 0` }} /></Tooltip>}
            </Group>
          ) : <Alert color="yellow" icon={<IconInfoCircle size={16} />} p="xs">Нет стоимости без НДС — доли не посчитаются. Задайте стоимость или лимиты суммами.</Alert>}
          {margin != null && margin < 0 && <Box mt={6}><StatusMark status="critical" size="xs" label={`Лимиты больше стоимости на ${rub(-margin)} — заложен убыток`} /></Box>}
        </div>

        <Table.ScrollContainer minWidth={780}>
          <Table verticalSpacing={6} fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Статья расходов</Table.Th>
                <Table.Th w={170}>Способ</Table.Th>
                <Table.Th w={170}>Значение</Table.Th>
                <Table.Th w={150} ta="right">Лимит без НДС</Table.Th>
                <Table.Th w={210}>Кто устанавливает</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {articles.map((a) => {
                const l = limits[a.id];
                const key = `limit.${a.id}.`;
                return (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      <Group gap={8} wrap="nowrap" align="flex-start">
                        <Box w={10} h={10} mt={5} style={{ borderRadius: 2, flexShrink: 0, background: articleColor(data.articles, a.id) }} />
                        <div>
                          <Group gap={4} wrap="nowrap">
                            <Text size="sm">{a.name}</Text>
                            {a.method && (
                              <Tooltip label={a.method} multiline w={360} style={{ whiteSpace: 'pre-line' }}>
                                <IconInfoCircle size={15} color="var(--mantine-color-dimmed)" aria-label="Методика" />
                              </Tooltip>
                            )}
                          </Group>
                          {econIsCompanyKind(a.kind) && <Text size="xs" c="dimmed">факт — общей суммой, разносится по выручке</Text>}
                          {a.id === subcontract?.id && budget.contractors.length > 0 && (
                            <Contractors budget={budget} vat={vat} vatExempt={vatExempt} canEdit={canEdit} onApply={(amount, names) => change(a.id, { method: 'AMOUNT', amount, setBy: 'ПЭО по договорам подрядчиков', note: names })} />
                          )}
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <SegmentedControl size="xs" value={l.method} onChange={(v) => change(a.id, { method: v as EconLimitMethod })} disabled={!canEdit} data={[{ value: 'SHARE', label: '% стоим.' }, { value: 'AMOUNT', label: 'Сумма' }]} aria-label={`${a.name}: способ`} />
                    </Table.Td>
                    <Table.Td>
                      {l.method === 'SHARE' ? (
                        <NumberInput size="xs" value={l.sharePct ?? ''} onChange={(v) => change(a.id, { sharePct: numOrNull(v) })} min={0} max={100} decimalScale={3} decimalSeparator="," hideControls suffix=" %" disabled={!canEdit} error={fields[key + 'sharePct']} aria-label={`${a.name}: доля, %`} />
                      ) : (
                        <NumberInput size="xs" value={l.amount ?? ''} onChange={(v) => change(a.id, { amount: numOrNull(v) })} {...moneyInput} disabled={!canEdit} error={fields[key + 'amount']} aria-label={`${a.name}: сумма, ₽`} />
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={500}>{rub(values[a.id])}</Text>
                      <Text size="xs" c="dimmed">{l.method === 'AMOUNT' ? share(values[a.id], base) : values[a.id] != null ? 'по доле' : ''}</Text>
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={l.setBy} onChange={(e) => change(a.id, { setBy: e.currentTarget.value })} placeholder="ПЭО, тех. часть…" disabled={!canEdit} error={fields[key + 'setBy']} aria-label={`${a.name}: кто устанавливает`} />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              <Table.Tr>
                <Table.Td colSpan={3}><Text fw={600}>Итого лимит</Text></Table.Td>
                <Table.Td ta="right"><Text fw={650}>{rub(total || null)}</Text><Text size="xs" c="dimmed">{share(total || null, base)} стоимости</Text></Table.Td>
                <Table.Td />
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={6}>Физические показатели</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Stack gap={4}>
              <NumberInput label="Норма трудочасов, чел.-ч" value={labor ?? ''} onChange={(v) => setLabor(numOrNull(v))} {...moneyInput} disabled={!canEdit} error={fields.laborHoursNorm} />
              {canEdit && fot && <RateHint limit={values[fot.id]} rate={data.settings.laborRate} unit="чел.-ч" what="ФОТ" onApply={setLabor} />}
            </Stack>
            <Stack gap={4}>
              <NumberInput label="Норма машино-часов, маш.-ч" value={machine ?? ''} onChange={(v) => setMachine(numOrNull(v))} {...moneyInput} disabled={!canEdit} error={fields.machineHoursNorm} />
              {canEdit && machinery && <RateHint limit={values[machinery.id]} rate={data.settings.machineRate} unit="маш.-ч" what="техники" onApply={setMachine} />}
            </Stack>
          </SimpleGrid>
        </div>
        <Textarea label="Примечание" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} maxRows={6} disabled={!canEdit} error={fields.note} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="space-between">
          {canEdit ? (
            <Button variant="subtle" color={budget.isArchived ? undefined : 'red'} leftSection={budget.isArchived ? <IconRestore size={16} /> : <IconArchive size={16} />} onClick={() => save(!budget.isArchived)} loading={busy}>
              {budget.isArchived ? 'Восстановить' : 'В архив'}
            </Button>
          ) : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>{canEdit ? 'Отмена' : 'Закрыть'}</Button>
            {canEdit && <Button loading={busy} onClick={() => save()}>Сохранить</Button>}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Подсказка нормы часов: лимит статьи ÷ ставка из настроек раздела. */
function RateHint({ limit, rate, unit, what, onApply }: { limit: number | null; rate: number | null | undefined; unit: string; what: string; onApply: (v: number) => void }) {
  if (!rate) return <Text size="xs" c="dimmed">Задайте ставку в меню раздела «Ставки и НДС», чтобы считать норму из лимита {what}.</Text>;
  if (!limit) return <Text size="xs" c="dimmed">Норму можно рассчитать из лимита {what} — задайте лимит.</Text>;
  const v = Math.round(limit / rate);
  return (
    <Group gap={6}>
      <Text size="xs" c="dimmed">Лимит {what} ÷ {rub(rate)} = {qty(v)} {unit}</Text>
      <Button size="compact-xs" variant="light" leftSection={<IconTransferIn size={12} />} onClick={() => onApply(v)}>Подставить</Button>
    </Group>
  );
}

/** Договоры подрядчиков из дашборда: выбор сторонних организаций → лимит «Субподряд» суммой без НДС. */
function Contractors({ budget, vat, vatExempt, canEdit, onApply }: { budget: EconBudget; vat: number; vatExempt: boolean; canEdit: boolean; onApply: (amount: number, names: string) => void }) {
  const [picked, setPicked] = useState<string[]>(() => budget.contractors.filter((c) => !c.own).map((c) => c.name));
  const [open, setOpen] = useState(false);
  const external = budget.contractors.filter((c) => !c.own).reduce((s, c) => s + c.amountGross, 0);
  const sum = budget.contractors.filter((c) => picked.includes(c.name)).reduce((s, c) => s + c.amountGross, 0);
  const net = econNet(sum, vat, vatExempt) ?? 0;
  return (
    <Popover opened={open} onChange={setOpen} width={420} position="bottom-start" withinPortal zIndex={1000} shadow="md">
      <Popover.Target>
        <Button size="compact-xs" variant="light" mt={4} leftSection={<IconTransferIn size={12} />} onClick={() => setOpen((o) => !o)}>
          Договоры подрядчиков: сторонние {money(econNet(external, vat, vatExempt))}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6}>
          <Text size="xs" c="dimmed">Договоры и работы подрядчиков в дашборде (с НДС). Свои подразделения (СМУ, РСУ, участки) по умолчанию не отмечены — это не субподряд.</Text>
          <Stack gap={4} mah={260} style={{ overflowY: 'auto' }}>
            {budget.contractors.map((c) => (
              <Checkbox
                key={c.name}
                size="xs"
                checked={picked.includes(c.name)}
                onChange={(e) => setPicked((p) => (e.currentTarget.checked ? [...p, c.name] : p.filter((x) => x !== c.name)))}
                label={<Group gap={6} wrap="nowrap" justify="space-between" w={340}><Text size="xs" lineClamp={1}>{c.name}{c.own ? ' · свои' : ''}</Text><Text size="xs" style={{ whiteSpace: 'nowrap' }}>{money(c.amountGross)}</Text></Group>}
              />
            ))}
          </Stack>
          <Group justify="space-between">
            <Text size="sm" fw={600}>Без НДС: {rub(net)}</Text>
            {canEdit && <Button size="xs" disabled={!net} onClick={() => { onApply(Math.round(net * 100) / 100, budget.contractors.filter((c) => picked.includes(c.name)).map((c) => c.name).join(', ').slice(0, 2000)); setOpen(false); }}>Подставить в лимит</Button>}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
