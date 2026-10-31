import { Alert, Badge, Group, Select, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { IconCalendar, IconPencil } from '@tabler/icons-react';
import { directionQueries, directionsQuery, meQuery } from '../api';
import { DirectionIcon } from '../ui/DirectionIcon';
import { canSee, hasFeature } from '../ui/access';
import { date as fmtDate, weekLabel } from '../ui/format';
import type { DirectionSearch, DirectionTab } from './direction/search';
import { OverviewTab } from './direction/OverviewTab';
import { SitesTab } from './direction/SitesTab';
import { MatrixTab } from './direction/MatrixTab';
import { ScheduleTab } from './direction/ScheduleTab';
import { TrackersTab } from './direction/TrackersTab';
import { PeopleTab } from './direction/PeopleTab';
import { DynamicsTab } from './direction/DynamicsTab';
import { SettingsTab } from './direction/SettingsTab';
import { SiteDrawer } from './direction/SiteDrawer';
import { EntryTab } from './direction/EntryTab';
import { ReportEntry } from './direction/ReportEntry';
import { JournalTab } from './direction/JournalTab';
import { ManageTab } from './direction/ManageTab';
import { RemarksTab } from './direction/RemarksTab';
import { RemarkDrawer } from './direction/RemarkDrawer';

const route = getRouteApi('/app/d/$code');

/**
 * Страница направления. Набор вкладок зависит от данных: «График работ» — если есть плановые сроки,
 * «Надстройки» — если они заведены. Единая карта находится в отдельном разделе меню.
 * Вкладки, скрытые в карточке сотрудника, не показываются (их данные сервер и не отдаёт).
 */
export function DirectionPage() {
  const { code } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { data: dirs } = useQuery(directionsQuery);
  const { data: periods = [] } = useQuery(directionQueries.periods(code));
  const { data: kpi } = useQuery(directionQueries.kpi(code, search.date));
  const { data: me } = useQuery(meQuery);
  const see = (t: DirectionTab) => t === 'overview' || t === 'entry' || t === 'manage' || (t === 'journal' ? hasFeature(me, 'audit') : canSee(me, t));
  const { data: trackers } = useQuery({ ...directionQueries.trackers(code), enabled: !!me && see('trackers') });
  const { data: remarks } = useQuery({ ...directionQueries.remarks(code), enabled: !!me && see('remarks') });
  const activeRemarks = remarks?.rows.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length ?? 0;
  const overdueRemarks = remarks?.rows.filter((r) => r.overdue).length ?? 0;
  const d = dirs?.find((x) => x.code === code);
  const myRole = me?.directions.find((x) => x.code === code)?.role;
  const canEnter = !!d && !d.isReadonly && (me?.globalRole === 'ADMIN' || myRole === 'CURATOR' || myRole === 'EDITOR');
  const canManage = me?.globalRole === 'ADMIN' || myRole === 'CURATOR';

  const set = (patch: Partial<DirectionSearch>) => navigate({ search: (s: DirectionSearch) => ({ ...s, ...patch }) });
  const openSite = (id: number) => set({ site: id });

  const available: Record<DirectionTab, boolean> = {
    overview: true,
    sites: true,
    matrix: true,
    schedule: kpi?.planDate != null,
    trackers: !!trackers?.trackers.some((t) => t.rows.length),
    people: true,
    dynamics: true,
    entry: canEnter,
    remarks: true,
    manage: canManage,
    journal: true,
    settings: true,
  };
  for (const t of Object.keys(available) as DirectionTab[]) available[t] &&= see(t);
  const tab = search.tab && available[search.tab] ? search.tab : 'overview';

  if (dirs && !d) return <Alert color="red">Направление не найдено или нет доступа</Alert>;

  const dates = [...new Map(periods.map((p) => [p.date, p])).values()];
  const label = (iso: string, l: string | null) =>
    d?.periodKind === 'WEEK' ? weekLabel(iso) : d?.periodKind === 'REPORT' ? `отчёт ${l ?? fmtDate(iso)}` : fmtDate(iso);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          {d && <DirectionIcon icon={d.icon} color={d.color} size={40} />}
          <div>
            <Title order={2}>{d?.name ?? ' '}</Title>
            <Text c="dimmed" size="sm">
              {d ? `${d.sitesCount} ${d.siteUnit}` : ''}
              {d?.curators.length ? ` · куратор: ${d.curators.map((c) => c.fullName).join(', ')}` : ' · куратор не назначен'}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          {search.date && (
            <Badge variant="light" color="orange">
              срез на прошлую дату
            </Badge>
          )}
          <Select
            w={260}
            leftSection={<IconCalendar size={16} />}
            aria-label="Дата среза"
            searchable
            value={search.date ?? ''}
            onChange={(v) => set({ date: v || undefined })}
            data={[{ value: '', label: 'Последняя отчётная точка' }, ...dates.map((p) => ({ value: p.date, label: label(p.date, p.label) }))]}
            allowDeselect={false}
          />
        </Group>
      </Group>

      {/* На телефоне тот же набор разрешённых вкладок доступен без многострочной панели. */}
      <Select hiddenFrom="sm" label="Раздел направления" value={tab} allowDeselect={false}
        onChange={(v) => set({ tab: (v as DirectionTab) ?? 'overview' })}
        data={([
          ['entry', 'Ввод данных'], ['overview', 'Обзор'], ['sites', 'Объекты'], ['matrix', 'Матрица'],
          ['schedule', 'График работ'], ['trackers', 'Надстройки'], ['dynamics', 'Динамика'],
          ['remarks', `Замечания${activeRemarks ? ` · ${activeRemarks}` : ''}`], ['people', 'Ответственные'],
          ['manage', 'Управление'], ['journal', 'Журнал'], ['settings', 'Устройство'],
        ] as [DirectionTab, string][]).filter(([value]) => available[value]).map(([value, label]) => ({ value, label }))} />

      <Tabs value={tab} onChange={(v) => set({ tab: (v as DirectionTab) ?? 'overview' })} keepMounted={false}>
        <Tabs.List visibleFrom="sm">
          {available.entry && (
            <Tabs.Tab value="entry" leftSection={<IconPencil size={16} />} fw={600}>
              Ввод данных
            </Tabs.Tab>
          )}
          <Tabs.Tab value="overview">Обзор</Tabs.Tab>
          {available.sites && <Tabs.Tab value="sites">Объекты</Tabs.Tab>}
          {available.matrix && <Tabs.Tab value="matrix">Матрица</Tabs.Tab>}
          {available.schedule && <Tabs.Tab value="schedule">График работ</Tabs.Tab>}
          {available.trackers && <Tabs.Tab value="trackers">Надстройки</Tabs.Tab>}
          {available.dynamics && <Tabs.Tab value="dynamics">Динамика</Tabs.Tab>}
          {available.remarks && <Tabs.Tab value="remarks" rightSection={activeRemarks ? <Badge size="sm" variant="light" color={overdueRemarks ? "red" : "gray"}>{activeRemarks}</Badge> : undefined}>
            Замечания
          </Tabs.Tab>}
          {available.people && <Tabs.Tab value="people">Ответственные</Tabs.Tab>}
          {available.manage && <Tabs.Tab value="manage">Управление</Tabs.Tab>}
          {available.journal && <Tabs.Tab value="journal">Журнал</Tabs.Tab>}
          {available.settings && <Tabs.Tab value="settings">Устройство</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="manage" pt="md">
          <ManageTab code={code} editId={search.edit} onEdit={(id) => set({ edit: id })} />
        </Tabs.Panel>
        <Tabs.Panel value="entry" pt="md">
          {d && (d.periodKind === 'REPORT' ? <ReportEntry code={code} /> : <EntryTab code={code} periodKind={d.periodKind} />)}
        </Tabs.Panel>
        <Tabs.Panel value="journal" pt="md">
          <JournalTab code={code} />
        </Tabs.Panel>
        <Tabs.Panel value="overview" pt="md">
          <OverviewTab code={code} date={search.date} onOpenSite={openSite} onShowSites={() => set({ tab: 'sites' })} />
        </Tabs.Panel>
        <Tabs.Panel value="sites" pt="md">
          <SitesTab code={code} date={search.date} contractor={search.contractor} onContractor={(v) => set({ contractor: v })} onOpenSite={openSite} />
        </Tabs.Panel>
        <Tabs.Panel value="matrix" pt="md">
          <MatrixTab code={code} date={search.date} onOpenSite={openSite} />
        </Tabs.Panel>
        <Tabs.Panel value="schedule" pt="md">
          <ScheduleTab code={code} date={search.date} onOpenSite={openSite} />
        </Tabs.Panel>
        <Tabs.Panel value="trackers" pt="md">
          <TrackersTab code={code} onOpenSite={openSite} />
        </Tabs.Panel>
        <Tabs.Panel value="dynamics" pt="md">
          <DynamicsTab code={code} date={search.date} />
        </Tabs.Panel>
        <Tabs.Panel value="remarks" pt="md">
          <RemarksTab key={search.rv ?? ''} code={code} initial={search.rv} onOpen={(id) => set({ remark: id })} />
        </Tabs.Panel>
        <Tabs.Panel value="people" pt="md">
          <PeopleTab code={code} />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="md">
          <SettingsTab code={code} />
        </Tabs.Panel>
      </Tabs>

      <SiteDrawer
        code={code}
        date={search.date}
        siteId={search.site}
        onClose={() => set({ site: undefined })}
        onEditSite={(id) => set({ site: undefined, tab: 'manage', edit: id })}
        onOpenRemark={(id) => set({ remark: id })}
      />
      <RemarkDrawer code={code} remarkId={search.remark} onClose={() => set({ remark: undefined })} onOpenSite={(id) => set({ site: id, remark: undefined })} />
    </Stack>
  );
}
