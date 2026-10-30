import { Alert, Badge, Card, Group, SimpleGrid, Skeleton, Stack, Table, Tabs, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { MEMBER_ROLE_LABELS, MEMBER_SCOPE_LABELS, PERIOD_KIND_LABELS, PROGRESS_METHOD_LABELS, type MemberRole, type MemberScope } from '@mvs/shared';
import { api } from '../../api';

interface DirectionConfig {
  periodKind: keyof typeof PERIOD_KIND_LABELS;
  progressMethod: keyof typeof PROGRESS_METHOD_LABELS;
  thrWarn: string;
  thrCrit: string;
  sections: { id: number; name: string; note: string | null }[];
  workGroups: { id: number; name: string }[];
  workTypes: { id: number; name: string; unit: string | null; weight: string | null; groupId: number | null }[];
  statusDefs: { id: number; entity: string; name: string; color: string | null }[];
  fieldDefs: { id: number; entity: string; label: string; type: string; unit: string | null; groupName: string | null }[];
  trackers: { id: number; name: string; stages: { id: number; name: string }[]; items: { id: number }[] }[];
  members: { id: number; role: MemberRole; scope: MemberScope; user: { id: number; fullName: string; position: string | null } }[];
}

/** Как устроено направление: ответственные, правила расчёта, справочники. Правка — в конструкторе (этап 8). */
export function SettingsTab({ code }: { code: string }) {
  const { data: d, isLoading, error } = useQuery({
    queryKey: ['direction-config', code],
    queryFn: () => api<DirectionConfig>(`/directions/${code}/config`),
  });
  if (isLoading) return <Skeleton h={300} />;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!d) return null;

  const groupName = (id: number | null) => d.workGroups.find((g) => g.id === id)?.name ?? '—';
  const byRole = (r: MemberRole) => d.members.filter((m) => m.role === r);

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {PERIOD_KIND_LABELS[d.periodKind]} · {PROGRESS_METHOD_LABELS[d.progressMethod]} · пороги для объектов: отставание {Number(d.thrWarn)} п.п.,
        критично {Number(d.thrCrit)} п.п.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {(['CURATOR', 'EDITOR', 'VIEWER'] as const).map((r) => (
          <Card key={r} withBorder>
            <Text size="sm" c="dimmed">
              {MEMBER_ROLE_LABELS[r]}
            </Text>
            {byRole(r).length ? (
              byRole(r).map((m) => (
                <Text key={m.id} fw={500}>
                  {m.user.fullName}
                  <Text span size="xs" c="dimmed">
                    {m.user.position ? ` · ${m.user.position}` : ''}
                    {r === 'EDITOR' ? ` · ${MEMBER_SCOPE_LABELS[m.scope].toLowerCase()}` : ''}
                  </Text>
                </Text>
              ))
            ) : (
              <Text c="dimmed">не назначен</Text>
            )}
          </Card>
        ))}
      </SimpleGrid>

      <Tabs defaultValue="works" keepMounted={false} variant="pills">
        <Tabs.List>
          <Tabs.Tab value="works">Виды работ · {d.workTypes.length}</Tabs.Tab>
          <Tabs.Tab value="sections">Разделы · {d.sections.length}</Tabs.Tab>
          <Tabs.Tab value="statuses">Статусы · {d.statusDefs.length}</Tabs.Tab>
          <Tabs.Tab value="fields">Доп. поля · {d.fieldDefs.length}</Tabs.Tab>
          <Tabs.Tab value="trackers">Надстройки · {d.trackers.length}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="works" pt="md">
          <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Группа</Table.Th>
                <Table.Th>Вид работ</Table.Th>
                <Table.Th>Ед.</Table.Th>
                <Table.Th>Вес</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.workTypes.map((w) => (
                <Table.Tr key={w.id}>
                  <Table.Td>{groupName(w.groupId)}</Table.Td>
                  <Table.Td>{w.name}</Table.Td>
                  <Table.Td>{w.unit ?? '—'}</Table.Td>
                  <Table.Td>{w.weight ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          </Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="sections" pt="md">
          {d.sections.map((s) => (
            <Text key={s.id}>
              <b>{s.name}</b> {s.note && <Text span c="dimmed">— {s.note}</Text>}
            </Text>
          ))}
          {!d.sections.length && <Empty />}
        </Tabs.Panel>
        <Tabs.Panel value="statuses" pt="md">
          <Group gap="xs">
            {d.statusDefs.map((s) => (
              <Badge key={s.id} color={s.color ?? 'gray'} variant="light">
                {s.name}
              </Badge>
            ))}
          </Group>
          {!d.statusDefs.length && <Empty />}
        </Tabs.Panel>
        <Tabs.Panel value="fields" pt="md">
          {d.fieldDefs.map((f) => (
            <Text key={f.id}>
              <b>{f.label}</b>{' '}
              <Text span c="dimmed" size="sm">
                {f.groupName ? `${f.groupName} · ` : ''}
                {f.type}
                {f.unit ? `, ${f.unit}` : ''}
              </Text>
            </Text>
          ))}
          {!d.fieldDefs.length && <Empty />}
        </Tabs.Panel>
        <Tabs.Panel value="trackers" pt="md">
          {d.trackers.map((t) => (
            <Text key={t.id}>
              <b>{t.name}</b> — {t.items.length} строк, этапы: {t.stages.map((s) => s.name).join(', ')}
            </Text>
          ))}
          {!d.trackers.length && <Empty />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

const Empty = () => (
  <Text c="dimmed" size="sm">
    Нет.
  </Text>
);
