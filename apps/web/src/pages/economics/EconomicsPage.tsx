import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Menu, Modal, Skeleton, Stack, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { IconCash, IconChartBar, IconAlertTriangle, IconCoins, IconReportMoney, IconDatabaseImport, IconDots, IconHistory, IconTrash, IconListDetails, IconReceipt, IconRefresh, IconSettings, IconTargetArrow, IconUsers } from '@tabler/icons-react';
import { api, economicsQuery } from '../../api';
import { EconLimits } from './EconLimits';
import { EconOverview } from './EconOverview';
import { EconPnL } from './EconPnL';
import { EconCash } from './EconCash';
import { EconDeviations } from './EconDeviations';
import { EconFacts } from './EconFacts';
import { EconArticles } from './EconArticles';
import { EconEditorsDialog, EconJournal, EconSettingsDialog } from './EconDialogs';
import type { EconTab, EconomicsSearch } from './search';
import './economics.css';

const route = getRouteApi('/app/economics');

export function EconomicsPage() {
  const query = useQuery(economicsQuery);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const update = (patch: Partial<EconomicsSearch>) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
  const [dialog, setDialog] = useState<'editors' | 'settings' | null>(null);
  const [demo, setDemo] = useState<'load' | 'clear' | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoError, setDemoError] = useState('');
  const qc = useQueryClient();
  const data = query.data;

  if (query.error && !data)
    return (
      <Alert color="red" title="Не удалось загрузить раздел «Экономика»">
        <Stack gap="sm">
          <Text size="sm">{query.error.message}</Text>
          <Button variant="default" onClick={() => query.refetch()}>Повторить</Button>
        </Stack>
      </Alert>
    );
  if (!data) return <Stack><Skeleton height={44} /><Skeleton height={36} /><Skeleton height={320} /></Stack>;

  const { permissions: perm } = data;
  const tab: EconTab = search.tab === 'journal' && !data.canAudit ? 'overview' : (search.tab ?? 'overview');

  async function runDemo() {
    setBusy(true);
    setDemoError('');
    try {
      const r = await api<{ budgets: number; months?: number }>('/economics/demo', { method: demo === 'load' ? 'POST' : 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      notifications.show({ color: 'green', message: demo === 'load' ? `Загружено: центров затрат ${r.budgets}, месяцев факта ${r.months ?? 0}` : `Удалено центров затрат: ${r.budgets}` });
      setDemo(null);
    } catch (e) {
      setDemoError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <IconCoins size={28} aria-hidden />
          <div>
            <Title order={2} size="h3">Экономика</Title>
            <Text size="sm" c="dimmed">Нормы и лимиты расходов, факт ПЭО по месяцам · суммы без НДС (ставка {data.settings.vatRate}%)</Text>
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label="Обновить">
            <ActionIcon variant="default" aria-label="Обновить данные экономики" loading={query.isFetching} onClick={() => query.refetch()}><IconRefresh size={16} /></ActionIcon>
          </Tooltip>
          {(perm.canEdit || perm.canAdmin) && (
            <Menu position="bottom-end">
              <Menu.Target><ActionIcon variant="default" aria-label="Действия раздела"><IconDots size={18} /></ActionIcon></Menu.Target>
              <Menu.Dropdown>
                {perm.canEdit && <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => setDialog('settings')}>Ставки и НДС</Menu.Item>}
                {perm.canAdmin && <Menu.Item leftSection={<IconUsers size={16} />} onClick={() => setDialog('editors')}>Ответственные ПЭО</Menu.Item>}
                {perm.canAdmin && !data.hasDemo && <Menu.Item leftSection={<IconDatabaseImport size={16} />} onClick={() => setDemo('load')}>Загрузить демо-данные</Menu.Item>}
                {perm.canAdmin && data.hasDemo && <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setDemo('clear')}>Удалить демо-данные</Menu.Item>}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      <Tabs value={tab} onChange={(v) => update({ tab: (v as EconTab) ?? undefined })} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>Обзор</Tabs.Tab>
          <Tabs.Tab value="pnl" leftSection={<IconReportMoney size={16} />}>Доходы и расходы</Tabs.Tab>
          <Tabs.Tab value="cash" leftSection={<IconCash size={16} />}>Движение денег</Tabs.Tab>
          <Tabs.Tab value="deviations" leftSection={<IconAlertTriangle size={16} />}>Отклонения</Tabs.Tab>
          <Tabs.Tab value="limits" leftSection={<IconTargetArrow size={16} />}>Лимиты</Tabs.Tab>
          <Tabs.Tab value="fact" leftSection={<IconReceipt size={16} />}>Факт за месяц</Tabs.Tab>
          <Tabs.Tab value="articles" leftSection={<IconListDetails size={16} />}>Статьи</Tabs.Tab>
          {data.canAudit && <Tabs.Tab value="journal" leftSection={<IconHistory size={16} />}>Журнал</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md"><EconOverview data={data} search={search} update={update} /></Tabs.Panel>
        <Tabs.Panel value="pnl" pt="md"><EconPnL data={data} search={search} update={update} /></Tabs.Panel>
        <Tabs.Panel value="cash" pt="md"><EconCash data={data} search={search} update={update} /></Tabs.Panel>
        <Tabs.Panel value="deviations" pt="md"><EconDeviations data={data} search={search} update={update} /></Tabs.Panel>
        <Tabs.Panel value="limits" pt="md"><EconLimits data={data} search={search} update={update} /></Tabs.Panel>
        <Tabs.Panel value="fact" pt="md"><EconFacts data={data} search={search} update={update} /></Tabs.Panel>
        <Tabs.Panel value="articles" pt="md"><EconArticles data={data} /></Tabs.Panel>
        {data.canAudit && <Tabs.Panel value="journal" pt="md"><EconJournal /></Tabs.Panel>}
      </Tabs>

      {dialog === 'settings' && <EconSettingsDialog settings={data.settings} onClose={() => setDialog(null)} />}
      {dialog === 'editors' && <EconEditorsDialog onClose={() => setDialog(null)} />}
      {demo && (
        <Modal opened onClose={() => setDemo(null)} title={demo === 'load' ? 'Загрузить демо-данные экономики?' : 'Удалить демо-данные экономики?'} size="md">
          <Stack gap="sm">
            <Text size="sm">
              {demo === 'load'
                ? 'Будут созданы центры затрат по направлениям (школы, лоты МКД, коллекторы и водные объекты Сетей, Благоустройство) с лимитами, факт ПЭО и КС-2 (где их нет в дашборде) за апрель–октябрь 2026 года по готовности работ из дашборда. Уже заданные центры затрат и внесённые данные не меняются.'
                : 'Удалятся только центры затрат, лимиты и факт, созданные демо-загрузкой. Данные, внесённые людьми, сохранятся.'}
            </Text>
            {demoError && <Alert color="red">{demoError}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDemo(null)}>Отмена</Button>
              <Button color={demo === 'clear' ? 'red' : undefined} loading={busy} onClick={runDemo}>{demo === 'load' ? 'Загрузить' : 'Удалить'}</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
