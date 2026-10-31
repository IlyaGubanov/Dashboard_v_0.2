import { useState } from 'react';
import { Alert, Badge, Box, Button, Group, Modal, Paper, SegmentedControl, Select, Stack, Switch, Table, Text, Tooltip } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import { ECON_SCOPE_LABELS, type EconArticle, type EconBudget, type EconScope, type EconSetup } from '@mvs/shared';
import { api } from '../../api';
import { pct } from '../../ui/format';
import { articleColor, budgetCode, downloadCsv, errorText, qty, rub, share } from './format';
import type { EconomicsSearch } from './search';
import { BudgetEditor } from './EconBudgetEditor';

const SHORT: Record<string, string> = { fot: 'ФОТ', materials: 'Материалы', machinery: 'Техника', subcontract: 'Субподряд', waste: 'Мусор', overhead: 'ОПР/ОХР', admin: 'Админ.' };
export const articleShort = (a: EconArticle) => SHORT[a.code] ?? a.name;
const margin = (b: EconBudget) => (b.costBase == null ? null : b.costBase - (b.limitTotal ?? 0));

/** Мини-полоса структуры стоимости: лимиты статей и остаток — плановая маржа. */
function MiniStructure({ b, articles }: { b: EconBudget; articles: EconArticle[] }) {
  if (!b.costBase || !b.limitTotal) return <Text span c="dimmed">—</Text>;
  const rest = Math.max(0, b.costBase - b.limitTotal);
  return (
    <Tooltip label={`Лимиты — ${share(b.limitTotal, b.costBase)} стоимости, маржа — ${share(b.costBase - b.limitTotal, b.costBase)}`}>
      <Group gap={1} wrap="nowrap" h={10} w={140} style={{ borderRadius: 3, overflow: 'hidden', background: 'var(--mantine-color-default-hover)' }}>
        {b.limits.filter((l) => l.value).map((l) => <Box key={l.articleId} h="100%" style={{ flex: `${l.value} 0 0`, background: articleColor(articles, l.articleId) }} />)}
        {rest > 0 && <Box h="100%" style={{ flex: `${rest} 0 0` }} />}
      </Group>
    </Tooltip>
  );
}

export const scopeColor: Record<EconScope, string> = { SITE: 'blue', SECTION: 'grape', DIRECTION: 'gray' };

interface Props { data: EconSetup; search: EconomicsSearch; update: (p: Partial<EconomicsSearch>) => void }

export function EconLimits({ data, search, update }: Props) {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const canEdit = data.permissions.canEdit;
  const articles = data.articles.filter((a) => !a.isArchived || data.budgets.some((b) => b.limits.some((l) => l.articleId === a.id)));
  const dirs = data.directions.filter((d) => !search.dir || d.id === search.dir);
  const budgets = data.budgets.filter((b) => (search.archive ? b.isArchived : !b.isArchived));
  const open = data.budgets.find((b) => b.id === openId);

  function exportCsv() {
    downloadCsv('Лимиты расходов.csv', [
      ['Код', 'Направление', 'Центр затрат', 'Вид', 'Объектов', 'Стоимость с НДС (дашборд)', 'Стоимость без НДС', ...articles.map((a) => `${a.name}, ₽`), 'Итого лимит, ₽', 'Норма трудочасов', 'Норма маш.-часов'],
      ...budgets.map((b) => [
        budgetCode(b),
        data.directions.find((d) => d.id === b.directionId)?.name,
        b.title,
        ECON_SCOPE_LABELS[b.scope],
        b.sitesCount,
        b.costGross,
        b.costBase,
        ...articles.map((a) => b.limits.find((l) => l.articleId === a.id)?.value ?? null),
        b.limitTotal,
        b.laborHoursNorm,
        b.machineHoursNorm,
      ]),
    ]);
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" gap="sm">
        <Group gap="sm" align="flex-end">
          <Select
            label="Направление"
            w={240}
            data={[{ value: '', label: 'Все направления' }, ...data.directions.map((d) => ({ value: String(d.id), label: d.shortName }))]}
            value={search.dir ? String(search.dir) : ''}
            onChange={(v) => update({ dir: v ? Number(v) : undefined })}
            allowDeselect={false}
          />
          <Switch label="Архив" checked={!!search.archive} onChange={(e) => update({ archive: e.currentTarget.checked || undefined })} mb={8} />
        </Group>
        <Group gap="xs">
          {data.canExport && <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv}>Выгрузить (CSV)</Button>}
          {canEdit && <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Центр затрат</Button>}
        </Group>
      </Group>

      <Text size="sm" c="dimmed">
        Центр затрат — крупный объект, лот или всё направление. Лимит лота покрывает объекты лота без своего бюджета, лимит направления — остальные объекты.
        Доля считается от стоимости без НДС: из дашборда за вычетом НДС или заданной ПЭО.
      </Text>

      {!data.directions.length && <Alert color="gray">Нет направлений, доступных вам в разделе.</Alert>}
      {dirs.map((d) => {
        const list = budgets.filter((b) => b.directionId === d.id).sort((a, b) => a.scope.localeCompare(b.scope) || a.title.localeCompare(b.title, 'ru'));
        if (!list.length && (search.archive || !canEdit)) return null;
        return (
          <Paper key={d.id} withBorder p="md" radius="md">
            <Group justify="space-between" mb="xs">
              <div>
                <Text fw={600}>{d.shortName}</Text>
                <Text size="xs" c="dimmed">{d.name}</Text>
              </div>
            </Group>
            {!list.length ? (
              <Text size="sm" c="dimmed">Центров затрат пока нет. Добавьте крупный объект, лот или всё направление и задайте лимиты по статьям.</Text>
            ) : (
              <Table.ScrollContainer minWidth={1200}>
                <Table highlightOnHover verticalSpacing={6} fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }} className="econ-nowrap">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Центр затрат</Table.Th>
                      <Table.Th ta="right">Стоимость без НДС</Table.Th>
                      <Table.Th ta="right">Готовность</Table.Th>
                      <Table.Th>Структура</Table.Th>
                      {articles.map((a) => (
                        <Table.Th key={a.id} ta="right"><Tooltip label={a.name}><span>{articleShort(a)}</span></Tooltip></Table.Th>
                      ))}
                      <Table.Th ta="right">Итого лимит</Table.Th>
                      <Table.Th ta="right">Плановая маржа</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {list.map((b) => (
                      <Table.Tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(b.id)}>
                        <Table.Td miw={240}>
                          <Text size="sm" fw={500} lineClamp={2}>{b.title}</Text>
                          <Group gap={6} wrap="nowrap" mt={2}>
                            <Badge size="xs" variant="light" color={scopeColor[b.scope]} style={{ flexShrink: 0 }}>{ECON_SCOPE_LABELS[b.scope]}</Badge>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{budgetCode(b)} · объектов: {b.sitesCount}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{rub(b.costBase)}{b.costNet != null && <Text size="xs" c="dimmed">задано ПЭО</Text>}</Table.Td>
                        <Table.Td ta="right">{pct(b.progress, 0)}</Table.Td>
                        <Table.Td w={150}><MiniStructure b={b} articles={data.articles} /></Table.Td>
                        {articles.map((a) => {
                          const l = b.limits.find((x) => x.articleId === a.id);
                          return (
                            <Table.Td key={a.id} ta="right">
                              {l ? rub(l.value) : <Text span c="dimmed">—</Text>}
                              {l?.method === 'SHARE' && <Text size="xs" c="dimmed">{qty(l.sharePct)} %</Text>}
                            </Table.Td>
                          );
                        })}
                        <Table.Td ta="right" fw={600}>{rub(b.limitTotal)}</Table.Td>
                        <Table.Td ta="right" c={margin(b) != null && margin(b)! < 0 ? 'var(--status-critical)' : undefined}>{rub(margin(b))}<Text size="xs" c="dimmed">{share(margin(b), b.costBase)}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>
        );
      })}

      {adding && <AddBudgetDialog data={data} defaultDir={search.dir} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setOpenId(id); }} />}
      {open && <BudgetEditor budget={open} data={data} onClose={() => setOpenId(null)} />}
    </Stack>
  );
}

function AddBudgetDialog({ data, defaultDir, onClose, onCreated }: { data: EconSetup; defaultDir?: number; onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [dirId, setDirId] = useState<string | null>(defaultDir ? String(defaultDir) : data.directions.length === 1 ? String(data.directions[0].id) : null);
  const [scope, setScope] = useState<EconScope>('SITE');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dir = data.directions.find((d) => String(d.id) === dirId);
  const taken = new Set(data.budgets.filter((b) => b.directionId === dir?.id).map((b) => (b.scope === 'SITE' ? `O${b.siteId}` : b.scope === 'SECTION' ? `S${b.sectionId}` : 'D')));
  const sectionName = (id: number | null) => dir?.sections.find((s) => s.id === id)?.name;
  const options =
    scope === 'SITE'
      ? (dir?.sites ?? []).filter((s) => !taken.has(`O${s.id}`)).map((s) => ({ value: String(s.id), label: sectionName(s.sectionId) ? `${s.name} · ${sectionName(s.sectionId)}` : s.name }))
      : (dir?.sections ?? []).filter((s) => !taken.has(`S${s.id}`)).map((s) => ({ value: String(s.id), label: s.name }));

  async function create() {
    if (!dir) return setError('Выберите направление');
    if (scope !== 'DIRECTION' && !target) return setError(scope === 'SITE' ? 'Выберите объект' : 'Выберите лот');
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: number }>('/economics/budgets', {
        method: 'POST',
        body: { directionId: dir.id, scope, sectionId: scope === 'SECTION' ? Number(target) : null, siteId: scope === 'SITE' ? Number(target) : null },
      });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      onCreated(r.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title="Новый центр затрат" size="md">
      <Stack gap="sm">
        <Select label="Направление" data={data.directions.map((d) => ({ value: String(d.id), label: d.shortName }))} value={dirId} onChange={(v) => { setDirId(v); setTarget(null); }} comboboxProps={{ zIndex: 1000 }} required />
        <div>
          <Text size="sm" fw={500} mb={4}>Что учитываем</Text>
          <SegmentedControl
            fullWidth
            value={scope}
            onChange={(v) => { setScope(v as EconScope); setTarget(null); }}
            data={[
              { value: 'SITE', label: 'Объект' },
              { value: 'SECTION', label: 'Лот', disabled: !dir?.sections.length },
              { value: 'DIRECTION', label: 'Направление', disabled: taken.has('D') },
            ]}
          />
          <Text size="xs" c="dimmed" mt={4}>
            {scope === 'SITE' ? 'Крупный объект (школа, Валдай): свои лимиты по статьям.' : scope === 'SECTION' ? 'Все объекты лота без своего бюджета — общий итог.' : 'Все объекты направления без своего бюджета — общий итог (благоустройство, спецработы).'}
          </Text>
        </div>
        {scope !== 'DIRECTION' && (
          <Select
            label={scope === 'SITE' ? 'Объект' : 'Лот'}
            data={options}
            value={target}
            onChange={setTarget}
            searchable
            nothingFoundMessage={dir ? 'Все уже добавлены' : 'Сначала выберите направление'}
            comboboxProps={{ zIndex: 1000 }}
            required
          />
        )}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={create}>Добавить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
