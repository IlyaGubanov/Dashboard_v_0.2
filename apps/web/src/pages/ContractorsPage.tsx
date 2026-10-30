import { Fragment, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { IconChevronDown, IconChevronRight, IconPlus, IconSearch } from '@tabler/icons-react';
import { CONTRACTOR_KINDS, ORGANIZATION_KIND_LABELS, type ContractorCreateInput, type ContractorRow, type ContractorsView } from '@mvs/shared';
import { api, ApiError, contractorsQuery } from '../api';
import { RiskBadge } from '../ui/RiskBadge';
import { Lag, LagIcon } from '../ui/Lag';
import { int, pct } from '../ui/format';

type Filter = 'all' | 'lag' | 'none';

/**
 * Подрядчики по всем направлениям: где работают, сколько объектов, сколько отстают.
 * Подрядчика можно добавить сразу в несколько направлений; привязка к объекту — в карточке объекта («Управление»).
 */
export function ContractorsPage() {
  const { data, error } = useQuery(contractorsQuery);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState<ContractorCreateInput | null>(null);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data?.rows ?? [])
      .map((r) => (dir ? narrow(r, dir) : r))
      .filter((r): r is ContractorRow => !!r)
      .filter((r) => !ql || r.name.toLowerCase().includes(ql) || r.inn?.includes(ql))
      .filter((r) => filter === 'all' || (filter === 'lag' ? r.lagging > 0 : r.sites.length === 0));
  }, [data, q, dir, filter]);

  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;
  const manageable = data.directions.filter((d) => d.canManage);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Подрядчики</Title>
          <Text c="dimmed" size="sm">
            Подрядные организации по всем направлениям: объекты, отставание от графика. Одна организация в разных направлениях
            собрана в одну строку — по ИНН, а без ИНН — по названию.
          </Text>
        </div>
        {manageable.length > 0 && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreate({ name: '', kind: 'CONTRACTOR', inn: '', note: '', directions: manageable.map((d) => d.code) })}>
            Добавить подрядчика
          </Button>
        )}
      </Group>

      <Card withBorder padding={0}>
        <Group p="md" gap="sm" wrap="wrap">
          <TextInput placeholder="Название или ИНН" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={260} />
          <Select
            placeholder="Все направления"
            clearable
            data={data.directions.map((d) => ({ value: d.code, label: d.shortName }))}
            value={dir}
            onChange={setDir}
            w={220}
            aria-label="Направление"
          />
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            data={[
              { value: 'all', label: 'Все' },
              { value: 'lag', label: 'Есть отставание' },
              { value: 'none', label: 'Без объектов' },
            ]}
          />
          <Text size="sm" c="dimmed" ml="auto">
            {rows.length} из {data.rows.length}
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th>Подрядчик</Table.Th>
                <Table.Th>Направления</Table.Th>
                <Table.Th ta="right">Объектов</Table.Th>
                <Table.Th ta="right">Отстают / критично</Table.Th>
                <Table.Th ta="right">Средняя готовность</Table.Th>
                {manageable.length > 0 && <Table.Th w={50} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => {
                const expanded = open === r.key;
                const missing = manageable.filter((d) => !r.directions.some((x) => x.code === d.code));
                return (
                  <Fragment key={r.key}>
                    <Table.Tr style={{ cursor: r.sites.length ? 'pointer' : undefined }} onClick={() => r.sites.length && setOpen(expanded ? null : r.key)}>
                      <Table.Td>{r.sites.length > 0 && (expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />)}</Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {r.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {[r.kinds.map((k) => ORGANIZATION_KIND_LABELS[k]).join(', '), r.inn && `ИНН ${r.inn}`].filter(Boolean).join(' · ')}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {r.directions.map((d) => (
                            <Badge key={d.orgId} size="sm" variant="light" color={d.color ?? 'gray'}>
                              {d.shortName}
                              {d.sites ? ` · ${d.sites}` : ''}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">{r.sites.length || '—'}</Table.Td>
                      <Table.Td ta="right">
                        {r.lagging > 0 ? (
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <LagIcon crit={r.critical > 0} />
                            <Text size="sm" fw={600}>
                              {int(r.lagging)} / {int(r.critical)}
                            </Text>
                          </Group>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{pct(avg(r.sites.map((s) => s.fact)))}</Table.Td>
                      {manageable.length > 0 && (
                        <Table.Td>
                          {missing.length > 0 && (
                            <Tooltip label="Добавить в другие направления">
                              <ActionIcon
                                variant="subtle"
                                aria-label="Добавить в другие направления"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCreate({ name: r.name, kind: r.kinds[0] ?? 'CONTRACTOR', inn: r.inn ?? '', note: '', directions: missing.map((d) => d.code) });
                                }}
                              >
                                <IconPlus size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                    {expanded && (
                      <Table.Tr>
                        <Table.Td />
                        <Table.Td colSpan={manageable.length > 0 ? 6 : 5} style={{ background: 'var(--surface-muted)' }}>
                          <Sites r={r} view={data} />
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!rows.length && (
          <Text c="dimmed" ta="center" p="lg">
            {data.rows.length ? 'Ничего не найдено' : 'Подрядчики пока не заведены'}
          </Text>
        )}
      </Card>

      <CreateModal value={create} onClose={() => setCreate(null)} directions={manageable} />
    </Stack>
  );
}

/** Объекты подрядчика с переходом в карточку объекта. */
function Sites({ r, view }: { r: ContractorRow; view: ContractorsView }) {
  const short = new Map(view.directions.map((d) => [d.code, d.shortName]));
  return (
    <Stack gap={2}>
      {r.sites.map((s) => (
        <UnstyledButton
          key={`${s.directionCode}-${s.siteId}`}
          className="row-link"
          px={6}
          py={4}
          renderRoot={(props) => <Link to="/d/$code" params={{ code: s.directionCode }} search={{ site: s.siteId }} {...props} />}
        >
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" truncate>
                {s.name}
              </Text>
              <Text size="xs" c="dimmed">
                {short.get(s.directionCode)}
                {s.role === 'items' ? ' · подрядчик отдельных работ' : ''} · факт {pct(s.fact, 0)}
                {s.plan != null ? ` · план ${pct(s.plan, 0)}` : ''}
              </Text>
            </div>
            <Group gap="md" wrap="nowrap">
              {s.lag != null && <Lag v={s.lag} crit={s.risk === 'crit'} />}
              <RiskBadge risk={s.risk} size="xs" />
            </Group>
          </Group>
        </UnstyledButton>
      ))}
    </Stack>
  );
}

function CreateModal({ value, onClose, directions }: { value: ContractorCreateInput | null; onClose: () => void; directions: ContractorsView['directions'] }) {
  const qc = useQueryClient();
  const [v, setV] = useState<ContractorCreateInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // новое значение снаружи — новая форма
  const [src, setSrc] = useState<ContractorCreateInput | null>(null);
  if (value !== src) {
    setSrc(value);
    setV(value);
    setErrors({});
  }

  async function save() {
    if (!v) return;
    setBusy(true);
    try {
      const r = await api<{ created: string[]; skipped: string[] }>('/contractors', { method: 'POST', body: v });
      await Promise.all([qc.invalidateQueries({ queryKey: ['contractors'] }), qc.invalidateQueries({ queryKey: ['dir'] })]);
      notifications.show({
        color: r.created.length ? 'green' : 'gray',
        message: [r.created.length && `Добавлен: ${r.created.join(', ')}`, r.skipped.length && `уже есть: ${r.skipped.join(', ')}`].filter(Boolean).join('; '),
      });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        if (!Object.keys(e.fields).length) notifications.show({ color: 'red', message: e.message });
      } else throw e;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={!!value} onClose={onClose} title="Подрядчик в направления">
      {v && (
        <Stack>
          <TextInput label="Название" required error={errors.name} value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
          <Group grow>
            <Select
              label="Роль"
              allowDeselect={false}
              data={CONTRACTOR_KINDS.map((k) => ({ value: k, label: ORGANIZATION_KIND_LABELS[k] }))}
              value={v.kind}
              onChange={(x) => setV({ ...v, kind: x as ContractorCreateInput['kind'] })}
            />
            <TextInput label="ИНН" error={errors.inn} value={v.inn ?? ''} onChange={(e) => setV({ ...v, inn: e.currentTarget.value })} />
          </Group>
          <MultiSelect
            label="Направления"
            description="Подрядчик появится в справочнике организаций каждого выбранного направления"
            required
            error={errors.directions}
            data={directions.map((d) => ({ value: d.code, label: d.shortName }))}
            value={v.directions}
            onChange={(x) => setV({ ...v, directions: x })}
          />
          <Textarea label="Примечание" value={v.note ?? ''} onChange={(e) => setV({ ...v, note: e.currentTarget.value })} />
          <Group justify="flex-end">
            <Button loading={busy} onClick={save}>
              Добавить
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Строка подрядчика только по одному направлению. */
function narrow(r: ContractorRow, code: string): ContractorRow | null {
  if (!r.directions.some((d) => d.code === code)) return null;
  const sites = r.sites.filter((s) => s.directionCode === code);
  return {
    ...r,
    directions: r.directions.filter((d) => d.code === code),
    sites,
    lagging: sites.filter((s) => s.risk === 'warn' || s.risk === 'crit').length,
    critical: sites.filter((s) => s.risk === 'crit').length,
  };
}

function avg(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
