import { useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Group, SegmentedControl, Select, SimpleGrid, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconPaperclip, IconPlus, IconSearch } from '@tabler/icons-react';
import { REMARK_ACTIVE, REMARK_CLOSED, REMARK_SEVERITIES, REMARK_SEVERITY_LABELS, type RemarkRow } from '@mvs/shared';
import { directionQueries, meQuery } from '../../api';
import { RemarkStatusBadge, SeverityLabel } from '../../ui/RemarkBadges';
import { date, int } from '../../ui/format';
import { RemarkForm } from './RemarkForm';

type View = 'active' | 'check' | 'closed' | 'all';
const VIEWS: Record<View, (r: RemarkRow) => boolean> = {
  active: (r) => REMARK_ACTIVE.includes(r.status),
  check: (r) => r.status === 'RESOLVED',
  closed: (r) => REMARK_CLOSED.includes(r.status),
  all: () => true,
};
const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/** Замечания направления: что требует действий, что ждёт проверки, что просрочено. */
export function RemarksTab({ code, onOpen, initial }: { code: string; onOpen: (id: number) => void; initial?: 'check' | 'mine' }) {
  const { data, error } = useQuery(directionQueries.remarks(code));
  const { data: me } = useQuery(meQuery);
  const [view, setView] = useState<View>(initial === 'check' ? 'check' : 'active');
  const [overdue, setOverdue] = useState(false);
  const [mine, setMine] = useState(initial === 'mine');
  const [sev, setSev] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? [])
      .filter(VIEWS[view])
      .filter((r) => !overdue || r.overdue)
      .filter((r) => !mine || r.assignee?.id === me?.id || r.author?.id === me?.id)
      .filter((r) => !sev || r.severity === sev)
      .filter((r) => !cat || r.category === cat)
      .filter((r) => !site || r.site.id === Number(site))
      .filter((r) => !s || `${r.num} ${r.text} ${r.site.name} ${r.assignee?.fullName ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.num - a.num);
  }, [data, view, overdue, mine, sev, cat, site, q, me]);

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;

  const all = data.rows;
  const month = Date.now() - 30 * 86_400_000;
  const stats = [
    { label: 'Требуют устранения', value: all.filter(VIEWS.active).length, onClick: () => (setView('active'), setOverdue(false)) },
    { label: 'Из них просрочено', value: all.filter((r) => r.overdue).length, onClick: () => (setView('active'), setOverdue(true)), critical: true },
    { label: 'Ждут проверки', value: all.filter(VIEWS.check).length, onClick: () => (setView('check'), setOverdue(false)) },
    { label: 'Закрыто за 30 дней', value: all.filter((r) => VIEWS.closed(r) && Date.parse(r.updatedAt) > month).length, onClick: () => (setView('closed'), setOverdue(false)) },
  ];
  const cats = [...new Set(all.map((r) => r.category).filter((c): c is string => !!c))].sort();
  const sites = [...new Map(all.map((r) => [r.site.id, r.site.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {stats.map((s) => (
          <Card key={s.label} withBorder padding="sm" component="button" onClick={s.onClick} style={{ cursor: 'pointer', textAlign: 'left' }}>
            <Text size="xs" c="dimmed">
              {s.label}
            </Text>
            <Text fz="calc(26px * var(--text-scale, 1))" fw={700} c={s.critical && s.value > 0 ? 'var(--status-critical)' : undefined}>
              {int(s.value)}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <Group justify="space-between" align="flex-end">
        <Group gap="sm" align="flex-end" maw="100%" miw={0}>
          <SegmentedControl
            style={{ maxWidth: '100%', overflowX: 'auto' }}
            value={view}
            onChange={(x) => setView(x as View)}
            data={[
              { value: 'active', label: 'Активные' },
              { value: 'check', label: 'На проверке' },
              { value: 'closed', label: 'Закрытые' },
              { value: 'all', label: 'Все' },
            ]}
          />
          <Checkbox label="Просроченные" checked={overdue} onChange={(e) => setOverdue(e.currentTarget.checked)} mb={6} />
          <Checkbox label="Мои" checked={mine} onChange={(e) => setMine(e.currentTarget.checked)} mb={6} />
        </Group>
        {data.canCreate && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            Новое замечание
          </Button>
        )}
      </Group>
      <Group gap="sm" grow preventGrowOverflow={false}>
        <TextInput leftSection={<IconSearch size={16} />} placeholder="Номер, текст, объект, исполнитель" value={q} onChange={(e) => setQ(e.currentTarget.value)} miw={220} />
        <Select aria-label="Объект" placeholder="Объект" searchable clearable data={sites.map(([id, name]) => ({ value: String(id), label: name }))} value={site} onChange={setSite} miw={200} />
        <Select aria-label="Важность" placeholder="Важность" clearable data={REMARK_SEVERITIES.map((s) => ({ value: s, label: REMARK_SEVERITY_LABELS[s] }))} value={sev} onChange={setSev} miw={150} />
        <Select aria-label="Категория" placeholder="Категория" clearable data={cats} value={cat} onChange={setCat} miw={180} />
      </Group>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={60}>№</Table.Th>
                <Table.Th>Замечание</Table.Th>
                <Table.Th w={130}>Важность</Table.Th>
                <Table.Th w={120}>Срок</Table.Th>
                <Table.Th w={170}>Исполнитель</Table.Th>
                <Table.Th w={140}>Статус</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id} style={{ cursor: 'pointer' }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.id); }} onClick={() => onOpen(r.id)}>
                  <Table.Td>
                    <Text fw={600}>{r.num}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500} lineClamp={2}>
                      {r.text}
                    </Text>
                    <Group gap={6} wrap="nowrap">
                      <Text size="xs" c="dimmed" truncate>
                        {r.site.name}
                        {r.category ? ` · ${r.category}` : ''}
                      </Text>
                      {r.photos > 0 && (
                        <Group gap={2} wrap="nowrap" c="dimmed">
                          <IconPaperclip size={12} aria-label="файлов" />
                          <Text size="xs">{r.photos}</Text>
                        </Group>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <SeverityLabel severity={r.severity} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={r.overdue ? 700 : 400} c={r.overdue ? 'var(--status-critical)' : undefined} style={{ whiteSpace: 'nowrap' }}>
                      {date(r.dueDate)}
                    </Text>
                    {r.overdue && (
                      <Text size="xs" c="var(--status-critical)">
                        просрочено
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" truncate>
                      {r.assignee?.fullName ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <RemarkStatusBadge status={r.status} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!rows.length && (
          <Text c="dimmed" ta="center" p="xl">
            {all.length ? 'Нет замечаний по выбранным условиям' : 'Замечаний пока нет'}
          </Text>
        )}
      </Card>
      <Text size="xs" c="dimmed">
        Показано {rows.length} из {all.length}. Сначала просроченные, затем по важности.
      </Text>

      <RemarkForm code={code} list={data} opened={creating} onClose={() => setCreating(false)} onSaved={onOpen} />
    </Stack>
  );
}
