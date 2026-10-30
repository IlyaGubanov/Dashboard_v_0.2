import { useCallback, useState } from 'react';
import { Alert, Badge, Box, Button, Drawer, Group, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { IconClockExclamation, IconPencil } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { TrackerEditor } from './TrackerEditor';
import type { SiteCard, SiteCardField, SiteCardTracker } from '@mvs/shared';
import { directionQueries } from '../../api';
import { EChart, type ChartColors } from '../../ui/EChart';
import { FactPlanBar } from '../../ui/FactPlanBar';
import { RiskBadge, riskColor } from '../../ui/RiskBadge';
import { factPlanChart } from '../../ui/charts';
import { TrackerValue, type TrackerRawValue, type TrackerStage } from '../../ui/TrackerValue';
import { date, int, money, pct } from '../../ui/format';
import { Lag } from '../../ui/Lag';
import { useFinanceHidden } from '../../ui/finance';
import { useAccess } from '../../ui/access';
import { SiteFiles, SiteRemarks } from './SiteExtras';
import { ForecastLabel } from '../../ui/ForecastLabel';

const ROLE: Record<string, string> = {
  CURATOR: 'Куратор',
  ENTRY: 'Ответственный за ввод',
  RESPONSIBLE: 'Ответственный',
  FOREMAN: 'Прораб',
  CHIEF_ENGINEER: 'ГИП',
};

/** Карточка объекта поверх страницы направления. */
export function SiteDrawer({
  code,
  date: asOf,
  siteId,
  onClose,
  onEditSite,
  onOpenRemark,
}: {
  code: string;
  date?: string;
  siteId?: number;
  onClose: () => void;
  onEditSite: (id: number) => void;
  onOpenRemark: (id: number) => void;
}) {
  const { data, error, isLoading } = useQuery({ ...directionQueries.site(code, siteId ?? 0, asOf), enabled: !!siteId });
  return (
    <Drawer
      opened={!!siteId}
      onClose={onClose}
      position="right"
      size="min(1100px, 100%)"
      title={
        data ? (
          <Group gap="md" wrap="nowrap" align="flex-start">
            <div>
              <Text fw={700} size="lg" lh={1.2}>
                {data.row.shortName}
              </Text>
              <Text size="sm" c="dimmed">
                {[data.row.section?.name, data.row.status?.name ?? data.row.statusText, data.address].filter(Boolean).join(' · ')}
              </Text>
            </div>
            {data.canManage && (
              <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => onEditSite(data.row.id)}>
                Изменить объект
              </Button>
            )}
          </Group>
        ) : (
          'Объект'
        )
      }
      // широкие таблицы прокручиваются внутри себя, панель не расширяют
      styles={{ body: { minWidth: 0, overflowX: 'hidden' }, content: { overflowX: 'hidden' } }}
    >
      {error && <Alert color="red">{(error as Error).message}</Alert>}
      {isLoading && <Skeleton h={400} />}
      {data && <Card data={data} code={code} onOpenRemark={onOpenRemark} />}
    </Drawer>
  );
}

function Card({ data: c, code, onOpenRemark }: { data: SiteCard; code: string; onOpenRemark: (id: number) => void }) {
  const r = c.row;
  const financeHidden = useFinanceHidden();
  const hasHistory = c.history.filter((h) => h.fact != null).length > 1;
  const showRemarks = useAccess().canSee('remarks');
  return (
    <Stack>
      <Box p="md" style={{ background: 'var(--surface-muted)', borderRadius: 8 }}>
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xs" c="dimmed">
              Готовность на {date(c.asOf)}
            </Text>
            <Text fz={32} fw={700} lh={1}>
              {pct(r.fact)}
            </Text>
          </div>
          {r.plan != null && (
            <div style={{ textAlign: 'right' }}>
              <Text size="sm">план {pct(r.plan)}</Text>
              <Lag v={r.lag} crit={r.risk === 'crit'} size="md" />
            </div>
          )}
          <RiskBadge risk={r.risk} />
        </Group>
        <FactPlanBar fact={r.fact} plan={r.plan} color={r.plan == null ? 'var(--series-1)' : riskColor(r.risk)} />
        <SimpleGrid cols={{ base: 2, sm: 4 }} mt="xs">
          <Kv k="Сроки" v={r.planStart || r.planEnd ? `${date(r.planStart)} — ${date(r.planEnd)}` : '—'} />
          {r.contractor && <Kv k="Подрядчик" v={r.contractor.name} />}
          {!financeHidden && r.money.portfolio != null && <Kv k="Стоимость" v={money(r.money.portfolio)} />}
          {!financeHidden && r.money.closed != null && <Kv k="Закрыто по КС-2" v={money(r.money.closed)} />}
          {!financeHidden && r.money.paid != null && <Kv k="Оплачено" v={money(r.money.paid)} />}
          {r.people != null && <Kv k="Людей / техники" v={`${int(r.people)} / ${int(r.tech)}`} />}
          {r.remarks != null && <Kv k="Замечаний" v={int(r.remarks)} />}
          {r.overdueItems > 0 && <Kv k="Просрочено позиций" v={int(r.overdueItems)} />}
          {r.forecast && r.forecast.status !== 'nodata' && r.forecast.status !== 'done' && <Kv k="Прогноз завершения" v={<ForecastLabel f={r.forecast} />} />}
          {r.remarksOpen > 0 && <Kv k="Замечаний не закрыто" v={`${int(r.remarksOpen)}${r.remarksOverdue ? `, просрочено ${int(r.remarksOverdue)}` : ''}`} />}
        </SimpleGrid>
      </Box>

      <Tabs defaultValue="items" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="items">Работы · {c.items.length}</Tabs.Tab>
          <Tabs.Tab value="passport">Паспорт и ответственные</Tabs.Tab>
          {hasHistory && <Tabs.Tab value="history">Динамика</Tabs.Tab>}
          {c.trackers.map((t) => (
            <Tabs.Tab key={t.code} value={`t-${t.code}`}>
              {t.name}
            </Tabs.Tab>
          ))}
          {!!c.contracts.length && <Tabs.Tab value="contracts">Договоры · {c.contracts.length}</Tabs.Tab>}
          {showRemarks && <Tabs.Tab value="remarks">Замечания{r.remarksOpen ? ` · ${r.remarksOpen}` : ''}</Tabs.Tab>}
          <Tabs.Tab value="files">Файлы и фото</Tabs.Tab>
        </Tabs.List>

        {showRemarks && (
          <Tabs.Panel value="remarks" pt="md">
            <SiteRemarks code={code} siteId={r.id} onOpen={onOpenRemark} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="files" pt="md">
          <SiteFiles siteId={r.id} />
        </Tabs.Panel>

        <Tabs.Panel value="items" pt="md">
          <Items c={c} />
        </Tabs.Panel>
        <Tabs.Panel value="passport" pt="md">
          <Passport c={c} />
        </Tabs.Panel>
        {hasHistory && (
          <Tabs.Panel value="history" pt="md">
            <History c={c} />
          </Tabs.Panel>
        )}
        {c.trackers.map((t) => (
          <Tabs.Panel key={t.code} value={`t-${t.code}`} pt="md">
            <Tracker t={t} code={code} siteId={c.row.id} canEdit={c.canEdit} />
          </Tabs.Panel>
        ))}
        <Tabs.Panel value="contracts" pt="md">
          <Table striped styles={{ td: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Номер</Table.Th>
                <Table.Th>Подрядчик</Table.Th>
                <Table.Th>Заключён</Table.Th>
                <Table.Th>Окончание</Table.Th>
                {!financeHidden && <Table.Th ta="right">Сумма</Table.Th>}
                {!financeHidden && <Table.Th ta="right">Аванс</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {c.contracts.map((k, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{k.number ?? '—'}</Table.Td>
                  <Table.Td>{k.organization ?? '—'}</Table.Td>
                  <Table.Td>{date(k.signedAt)}</Table.Td>
                  <Table.Td>{date(k.endAt)}</Table.Td>
                  {!financeHidden && <Table.Td ta="right">{money(k.amount)}</Table.Td>}
                  {!financeHidden && <Table.Td ta="right">{money(k.advance)}</Table.Td>}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {k}
      </Text>
      <Text component="div" size="sm" fw={500}>
        {v}
      </Text>
    </div>
  );
}

/** Позиции работ: факт, план на дату, объёмы, деньги, кто и когда внёс. */
function Items({ c }: { c: SiteCard }) {
  const financeHidden = useFinanceHidden();
  const has = {
    qty: c.items.some((i) => i.planQty != null),
    cost: !financeHidden && c.items.some((i) => i.planCost != null),
    ks: !financeHidden && c.items.some((i) => i.ks != null),
    contractor: c.items.some((i) => i.contractor),
    status: c.items.some((i) => i.status),
    plan: c.items.some((i) => i.plan != null),
    resp: c.items.some((i) => i.responsible),
  };
  return (
    <Table.ScrollContainer minWidth={800}>
      <Table striped highlightOnHover verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' } }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Работа</Table.Th>
            {has.status && <Table.Th>Статус</Table.Th>}
            <Table.Th ta="right">Факт</Table.Th>
            {has.plan && <Table.Th ta="right">План на дату</Table.Th>}
            {has.qty && <Table.Th ta="right">Объём факт / проект</Table.Th>}
            {has.cost && <Table.Th ta="right">Стоимость</Table.Th>}
            {has.ks && <Table.Th ta="right">КС-2 / оплачено</Table.Th>}
            <Table.Th>Сроки</Table.Th>
            {has.contractor && <Table.Th>Подрядчик</Table.Th>}
            {has.resp && <Table.Th>Ответственный</Table.Th>}
            <Table.Th>Внесено</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {c.items.map((i) => (
            <Table.Tr key={i.id} style={{ opacity: i.excluded ? 0.5 : 1 }}>
              <Table.Td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                <Text component="div" size="sm" fw={500}>
                  {i.name}
                  {i.isExample && (
                    <Badge ml={6} size="xs" variant="outline" color="gray">
                      демо
                    </Badge>
                  )}
                </Text>
                {i.group && (
                  <Text size="xs" c="dimmed">
                    {i.group}
                    {i.weight != null ? ` · вес ${i.weight}` : ''}
                  </Text>
                )}
              </Table.Td>
              {has.status && (
                <Table.Td>
                  {i.status ? (
                    <Group gap={6} wrap="nowrap">
                      <Box w={8} h={8} style={{ borderRadius: 4, background: i.status.color ?? 'var(--status-none)', flexShrink: 0 }} aria-hidden />
                      <Text size="sm">{i.status.name}</Text>
                    </Group>
                  ) : (
                    '—'
                  )}
                </Table.Td>
              )}
              <Table.Td ta="right">
                <Group gap={6} justify="flex-end" wrap="nowrap">
                  <Box w={50} h={6} style={{ background: 'var(--track)', borderRadius: 3 }}>
                    <Box h={6} style={{ width: `${i.fact * 100}%`, background: 'var(--series-1)', borderRadius: 3 }} />
                  </Box>
                  <Text size="sm" w={44}>
                    {pct(i.fact, 0)}
                  </Text>
                </Group>
              </Table.Td>
              {has.plan && (
                <Table.Td ta="right">
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    {i.overdue && (
                      <Tooltip label="Срок окончания прошёл, работа не выполнена">
                        <IconClockExclamation size={16} color="var(--status-critical)" aria-label="срок прошёл" />
                      </Tooltip>
                    )}
                    {pct(i.plan, 0)}
                  </Group>
                </Table.Td>
              )}
              {has.qty && (
                <Table.Td ta="right">
                  {i.factQty != null || i.planQty != null ? `${int(i.factQty)} / ${int(i.planQty)} ${i.unit ?? ''}` : '—'}
                </Table.Td>
              )}
              {has.cost && <Table.Td ta="right">{money(i.planCost)}</Table.Td>}
              {has.ks && (
                <Table.Td ta="right">
                  {money(i.ks)} / {money(i.paid)}
                </Table.Td>
              )}
              <Table.Td>{i.planStart || i.planEnd ? `${date(i.planStart)} — ${date(i.planEnd)}` : '—'}</Table.Td>
              {has.contractor && <Table.Td>{i.contractor ?? c.contractor ?? '—'}</Table.Td>}
              {has.resp && <Table.Td>{i.responsible ?? '—'}</Table.Td>}
              <Table.Td>
                {i.asOf ? (
                  <Tooltip label={i.enteredAt ? `внесено ${new Date(i.enteredAt).toLocaleString('ru-RU')}` : 'загружено из исходных данных'}>
                    <Text size="xs">
                      {date(i.asOf)}
                      {i.enteredBy ? ` · ${i.enteredBy}` : ''}
                    </Text>
                  </Tooltip>
                ) : (
                  <Text size="xs" c="dimmed">
                    нет данных
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function fieldValue(f: SiteCardField) {
  if (f.value == null || f.value === '') return '—';
  switch (f.type) {
    case 'MONEY':
      return money(Number(f.value));
    case 'PERCENT':
      return pct(Number(f.value) / 100);
    case 'NUMBER':
      return `${Number(f.value).toLocaleString('ru-RU')}${f.unit ? ` ${f.unit}` : ''}`;
    case 'BOOL':
      return f.value ? 'да' : 'нет';
    case 'SELECT':
      return f.options?.find((o) => o.value === f.value)?.label ?? String(f.value);
    case 'URL':
      return (
        <a href={String(f.value)} target="_blank" rel="noreferrer noopener">
          ссылка
        </a>
      );
    default:
      return String(f.value);
  }
}

function Passport({ c }: { c: SiteCard }) {
  const financeHidden = useFinanceHidden();
  const groups = new Map<string, SiteCardField[]>();
  for (const f of c.fields.filter((x) => !(financeHidden && x.type === 'MONEY'))) groups.set(f.group ?? 'Дополнительно', [...(groups.get(f.group ?? 'Дополнительно') ?? []), f]);
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        <Kv k="Полное название" v={c.row.name} />
        {c.address && c.address !== c.row.name && <Kv k="Адрес" v={c.address} />}
        {(c.okrug || c.district) && <Kv k="Округ / район" v={[c.okrug, c.district].filter(Boolean).join(' · ')} />}
        {c.contractor && <Kv k="Подрядчик" v={c.contractor} />}
        {c.designer && <Kv k="Проектировщик" v={c.designer} />}
        {!financeHidden && c.limit != null && <Kv k="Лимит" v={money(c.limit)} />}
        {c.row.lat != null && <Kv k="Координаты" v={`${c.row.lat}, ${c.row.lon}`} />}
        {c.note && <Kv k="Примечание" v={c.note} />}
      </SimpleGrid>

      <div>
        <Text fw={600} mb={6}>
          Ответственные
        </Text>
        {c.assignments.length ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {c.assignments.map((a, i) => (
              <Box key={i} p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
                <Text size="xs" c="dimmed">
                  {ROLE[a.role] ?? a.role}
                </Text>
                <Text fw={500}>{a.fullName}</Text>
                <Text size="xs" c="dimmed">
                  {[a.position, a.phone, a.email].filter(Boolean).join(' · ')}
                </Text>
              </Box>
            ))}
          </SimpleGrid>
        ) : (
          <Text size="sm" c="dimmed">
            Не назначены — назначаются в «Пользователи и роли» и в карточке объекта (этап 7).
          </Text>
        )}
      </div>

      {[...groups].map(([g, fs]) => (
        <div key={g}>
          <Text fw={600} mb={6}>
            {g}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {fs.map((f) => (
              <Kv key={f.code} k={f.label} v={fieldValue(f)} />
            ))}
          </SimpleGrid>
        </div>
      ))}
    </Stack>
  );
}

function History({ c }: { c: SiteCard }) {
  const pts = c.history.filter((h) => h.fact != null);
  const opt = useCallback((col: ChartColors) => factPlanChart(pts, col), [pts]);
  return <EChart option={opt} height={280} ariaLabel={`Динамика готовности объекта ${c.row.shortName}`} />;
}

/** Надстройка: строки × этапы (закупки, испытания) или карточка (МГЭ, документация). */
function Tracker({ t, code, siteId, canEdit }: { t: SiteCardTracker; code: string; siteId: number; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <TrackerEditor t={t} code={code} siteId={siteId} onDone={() => setEditing(false)} />;
  return (
    <Stack gap="sm">
      {canEdit && (
        <Group justify="flex-end">
          <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>
            Внести изменения
          </Button>
        </Group>
      )}
      <TrackerView t={t} />
    </Stack>
  );
}

function TrackerView({ t }: { t: SiteCardTracker }) {
  const show = (stage: TrackerStage, v: TrackerRawValue) => <TrackerValue stage={stage} value={v} />;

  if (t.layout === 'CARD') {
    const row = t.rows[0];
    return (
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        {t.stages.map((s) => (
          <Kv key={s.code} k={s.name} v={show(s, row?.values[s.code])} />
        ))}
      </SimpleGrid>
    );
  }
  const hasQty = t.rows.some((r) => r.qty != null);
  const hasDates = t.rows.some((r) => r.planDate || r.dueDate);
  const hasMaker = t.rows.some((r) => r.attrs?.maker || r.attrs?.supplier);
  return (
    <Table.ScrollContainer minWidth={700}>
      <Table striped verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' } }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Позиция</Table.Th>
            {hasMaker && <Table.Th>Производитель / поставщик</Table.Th>}
            {hasQty && <Table.Th ta="right">Кол-во</Table.Th>}
            {hasDates && <Table.Th>Поставка / завершение</Table.Th>}
            {t.stages.map((s) => (
              <Table.Th key={s.code}>{s.name}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {t.rows.map((r) => (
            <Table.Tr key={r.item.code}>
              <Table.Td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                <Text size="sm">{r.item.name}</Text>
                {r.item.category && (
                  <Text size="xs" c="dimmed">
                    {r.item.category}
                  </Text>
                )}
              </Table.Td>
              {hasMaker && <Table.Td>{[r.attrs?.maker, r.attrs?.supplier].filter(Boolean).join(' / ') || '—'}</Table.Td>}
              {hasQty && <Table.Td ta="right">{r.qty != null ? `${int(r.qty)} ${r.unit ?? ''}` : '—'}</Table.Td>}
              {hasDates && (
                <Table.Td>
                  {date(r.planDate)} / {date(r.dueDate)}
                </Table.Td>
              )}
              {t.stages.map((s) => (
                <Table.Td key={s.code}>{show(s, r.values[s.code])}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
